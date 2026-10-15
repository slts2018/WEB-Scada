import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './router'
import './styles/base.css'
import './styles/element-overlay.css'

/** 全局禁用浏览器默认右键菜单（不影响页面内自定义菜单监听） */
window.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true })

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.mount('#app')
