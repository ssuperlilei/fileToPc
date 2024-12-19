import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import pLimit from 'p-limit';
import { imageHash } from 'image-hash';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'url';

// 限制并发数
const limit = pLimit(5); // 可以根据需求调整并发数

// 将 PNG 图像转换为 JPEG 格式
async function convertToJpeg(imagePath) {
    const outputBuffer = await sharp(imagePath)
        .jpeg()
        .toBuffer(); // 转换为 JPEG 格式
    const tempPath = path.join(path.dirname(imagePath), 'temp_convert_to_jpeg_' + path.basename(imagePath, path.extname(imagePath)) + '.jpg');
    await fs.writeFile(tempPath, outputBuffer);
    return tempPath;
}

// 计算图像的哈希值
async function getImageHash(imagePath) {
    return new Promise((resolve, reject) => {
        imageHash(imagePath, 8, true, (err, hash) => {
            if (err) reject(err);
            else resolve(hash);
        });
    });
}

// 哈希值的海明距离计算（用于图像哈希相似度比较）
function hammingDistance(str1, str2) {
    let distance = 0;
    for (let i = 0; i < str1.length; i++) {
        if (str1[i] !== str2[i]) {
            distance++;
        }
    }
    return distance;
}

// 在 worker 线程中处理图像比较
function compareImagesWorker(imagePath1, imagePath2) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(fileURLToPath(import.meta.url), {
            workerData: { imagePath1, imagePath2 }
        });

        worker.on('message', resolve);
        worker.on('error', reject);
        worker.on('exit', (code) => {
            if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
        });
    });
}

// 延迟删除操作
async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 删除文件时添加延迟
async function deleteFileWithDelay(filePath) {
    try {
        // 检查文件是否存在
        const exists = await fs.pathExists(filePath);
        if (!exists) {
            console.log(`File does not exist: ${filePath}`);
            return;
        }

        // 添加延迟
        await delay(100); // 延迟 100 毫秒
        
        // 删除文件
        await fs.remove(filePath);
        console.log(`Deleted: ${filePath}`);
    } catch (err) {
        console.error(`Error deleting file ${filePath}:`, err);
    }
}

// Worker 线程任务
if (!isMainThread) {
    const { imagePath1, imagePath2 } = workerData;

    // 计算图像哈希值
    (async () => {
        // 如果是 PNG 格式，先转换为 JPEG 格式
        const tempImagePath1 = imagePath1.endsWith('.png') ? await convertToJpeg(imagePath1) : imagePath1;
        const tempImagePath2 = imagePath2.endsWith('.png') ? await convertToJpeg(imagePath2) : imagePath2;

        const hash1 = await getImageHash(tempImagePath1);
        const hash2 = await getImageHash(tempImagePath2);

        const hashSimilarity = hammingDistance(hash1, hash2);
        if (hashSimilarity < 5) {
            parentPort.postMessage(95); // 哈希值相似，直接返回95%的相似度
            return;
        }

        // 逐像素比较
        const img1 = sharp(tempImagePath1);
        const img2 = sharp(tempImagePath2);
        
        const metadata1 = await img1.metadata();
        const metadata2 = await img2.metadata();

        if (metadata1.width !== metadata2.width || metadata1.height !== metadata2.height) {
            parentPort.postMessage(0);
            return;
        }

        const buffer1 = await img1.resize(256, 256).raw().toBuffer(); // 缩放为 256x256 以减少比较量
        const buffer2 = await img2.resize(256, 256).raw().toBuffer();

        const diff = Buffer.alloc(buffer1.length);
        const numDiffPixels = pixelmatch(buffer1, buffer2, diff, 256, 256, { threshold: 0.1 }); // 使用调整后的宽度和高度
        const totalPixels = 256 * 256;
        const similarity = ((totalPixels - numDiffPixels) / totalPixels) * 100;

        parentPort.postMessage(similarity);

        // 删除临时转换的图像文件
        if (tempImagePath1 !== imagePath1) fs.removeSync(tempImagePath1);
        if (tempImagePath2 !== imagePath2) fs.removeSync(tempImagePath2);
    })();
} else {
    // 比较文件夹中的所有图片，并删除相似度超过 95% 的图片
    async function compareFolderImages(folderPath) {
        const files = await fs.readdir(folderPath);
        const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif|png)$/i.test(file)); // 包括 PNG 格式

        const imagePaths = imageFiles.map(file => path.join(folderPath, file));

        const deletionPromises = [];
        const tempFiles = [];

        for (let i = 0; i < imagePaths.length; i++) {
            for (let j = i + 1; j < imagePaths.length; j++) {
                const imagePath1 = imagePaths[i];
                const imagePath2 = imagePaths[j];

                const similarity = await limit(() => compareImagesWorker(imagePath1, imagePath2));

                if (similarity >= 95) {
                    console.log(`Images ${imagePaths[i]} and ${imagePaths[j]} are more than 95% similar.`);
                    const deletePromise = deleteFileWithDelay(imagePath1);
                    deletionPromises.push(deletePromise);
                    break;  // 删除一张图片后，跳到下一个比较
                }
            }
        }

        await Promise.all(deletionPromises);
        // 删除临时文件 temp_convert_to_jpeg_ 开头的文件
        const newFiles = await fs.readdir(folderPath);
        const tempFiles2 = newFiles.filter(file => file.startsWith('temp_convert_to_jpeg_'));
        console.log("Deleting temp files...", tempFiles2);
        for (const tempFile of tempFiles2) {
            await deleteFileWithDelay(path.join(folderPath, tempFile));
        }
        console.log("All deletions complete.");
    }

    const folderPath = '../images'; // 替换为你的文件夹路径
    compareFolderImages(folderPath).catch(err => console.error('Error comparing images:', err)).finally(() => process.exit());
}
