import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: '/designer',
    },
    {
      path: '/designer',
      name: 'designer',
      component: () => import('@/views/designer/DesignerView.vue'),
      meta: { title: '设计端' },
    },
    {
      path: '/runtime',
      name: 'runtime',
      component: () => import('@/views/runtime/RuntimeView.vue'),
      meta: { title: '运行端' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

router.afterEach((to) => {
  const title = (to.meta.title as string) || 'Web 组态'
  document.title = `${title} · Web 组态`
})

export default router
