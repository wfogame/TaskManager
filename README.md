<h1 align="center">
<img src="https://www.vectorlogo.zone/logos/nodejs/nodejs-icon.svg" width="80"><br>
<span style="background:linear-gradient(45deg,#6d28d9,#4c1d95);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Node.js Task Manager</span><br>
<img src="https://img.shields.io/badge/Node.js-18.x-green?logo=node.js"></h1>
<div align="center"><img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/colored.png" width="80%"></div>

## 📖 Table of Contents  
1. [Features](#-features)  
2. [Installation](#-installation)  
3. [API Docs](#-api-docs)  
4. [Architecture](#-architecture)  
5. [FAQ](#-faq)  

## 🚀 Features  
<table><tr><td width="33%"><h3>📦 Core</h3><ul><li>CRUD Operations</li><li>JSON Storage</li><li>Real-time Sync</li></ul></td><td width="33%"><h3>🎨 UI</h3><ul><li>Responsive Design</li><li>CSS Animations</li><li>Error Handling</li></ul></td><td width="33%"><h3>📚 Learning</h3><ul><li>Node.js Cheatsheet</li><li>Code Examples</li><li>Best Practices</li></ul></td></tr></table>

## 🔧 Installation  
```bash
git clone https://github.com/yourusername/nodejs-task-manager.git
cd nodejs-task-manager && node server.js
```

## 📚 API Docs  
```http
GET /api/tasks
POST /api/tasks
DELETE /api/tasks/:id
```  
| Method | Endpoint | Status Codes |  
|--------|----------|--------------|  
| `GET` | `/api/tasks` | 200 ✅ 404 ❌ |  
| `POST` | `/api/tasks` | 201 ✨ 400 ⚠️ |  
| `DELETE` | `/api/tasks/:id` | 204 🗑️ 404 ❌ |  

## 🏗 Architecture  
```text
┌─────────────┐ HTTP ┌─────────────┐ FS ┌─────────────┐
│  Browser    │◄────►│ Node Server │◄──►│ tasks.json │
└─────────────┘      └─────────────┘    └─────────────┘
```

## ❓ FAQ  
<details><summary>How to change port?</summary><br><code>PORT=4000 node server.js</code></details>  
<details><summary>Data storage?</summary><br>Stored in <code>tasks.json</code> using Node.js fs</details>

<div align="center"><img src="https://forthebadge.com/images/badges/built-with-love.svg"><br><img src="https://img.shields.io/badge/License-ISC-blue"></div>
