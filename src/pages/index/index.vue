<!-- 使用 type="home" 属性设置首页，其他页面不需要设置，默认为page；推荐使用json5，更强大，且允许注释 -->
<route lang="json5" type="home">
{
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '首页',
  },
}
</route>
<template>
  <wd-navbar title="小功能"></wd-navbar>
  <view class="bg-gray-100 h-lvh flex-items-start p-4">
    <wd-cell
      rd-4
      title="图片上传"
      value=""
      clickable
      label="讲手机的照片传到电脑，完成之后调用插件去重"
      icon="picture"
      @click="uploadImg"
    />
  </view>
</template>

<script lang="ts" setup>
import { TestEnum } from '@/typings'

defineOptions({
  name: 'Home',
})
// 测试 uni API 自动引入
onLoad(() => {
  console.log(TestEnum.A)
})

const uploadImg = () => {
  console.log('ssss')
}
</script>

<style>
.main-title-color {
  color: #d14328;
}
</style>
