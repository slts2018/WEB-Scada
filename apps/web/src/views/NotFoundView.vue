<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <div class="wrap">
    <h1>页面不存在</h1>
    <RouterLink to="/designer">返回设计端</RouterLink>
  </div>
</template>

<style scoped>
.wrap {
  height: 100%;
  display: grid;
  place-content: center;
  gap: 12px;
  text-align: center;
}
</style>
