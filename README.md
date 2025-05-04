<!-- Custom Header with Logo & Gradient Text -->
<h1 align="center">
  <img src="https://www.vectorlogo.zone/logos/nodejs/nodejs-icon.svg" alt="Node.js Logo" width="80">
  <br>
  <span style="background: linear-gradient(45deg, #6d28d9, #4c1d95); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 2.5em;">
    Ultimate Node.js Task Manager
  </span>
  <br>
  <img src="https://img.shields.io/badge/Powered_By-Pure_Node.js-339933?logo=node.js&logoColor=white" alt="Powered By Node.js">
</h1>

<!-- Animated Divider -->
<div align="center">
  <img src="https://raw.githubusercontent.com/andreasbm/readme/master/assets/lines/colored.png" width="80%">
</div>

## 📖 Table of Contents
1. [Features](#-feature-highlights)
2. [Screenshots](#-visual-showcase)
3. [Installation](#-installation-guide)
4. [API Docs](#-api-documentation)
5. [Architecture](#-system-architecture)
6. [Contributing](#-contributing-guide)
7. [FAQ](#-frequently-asked-questions)

## 🚀 Feature Highlights

<div align="center">
  <table>
    <tr>
      <td width="33%">
        <div align="center">
          <img src="https://cdn-icons-png.flaticon.com/512/1067/1067555.png" width="60">
          <h3>Core Functionality</h3>
          <ul align="left">
            <li>📝 Rich Text Task Creation</li>
            <li>⚡ Instant CRUD Operations</li>
            <li>🔐 Persistent JSON Storage</li>
            <li>📊 Real-time Updates</li>
          </ul>
        </div>
      </td>
      <td width="33%">
        <div align="center">
          <img src="https://cdn-icons-png.flaticon.com/512/954/954591.png" width="60">
          <h3>UI/UX Excellence</h3>
          <ul align="left">
            <li>🎨 Custom CSS Variables</li>
            <li>📱 Mobile-First Design</li>
            <li>🌈 Hover Animations</li>
            <li>🚦 Error Handling UI</li>
          </ul>
        </div>
      </td>
      <td width="33%">
        <div align="center">
          <img src="https://cdn-icons-png.flaticon.com/512/1826/1826521.png" width="60">
          <h3>Learning Resources</h3>
          <ul align="left">
            <li>📚 Node.js Core Cheatsheet</li>
            <li>🔗 Module References</li>
            <li>💡 Code Examples</li>
            <li>⚙️ Best Practices</li>
          </ul>
        </div>
      </td>
    </tr>
  </table>
</div>

## 📸 Visual Showcase

<div align="center">
  <table>
    <tr>
      <td><img src="https://via.placeholder.com/400x250.png?text=Home+Page" width="100%" style="border-radius:10px"></td>
      <td><img src="https://via.placeholder.com/400x250.png?text=Tasks+Page" width="100%" style="border-radius:10px"></td>
      <td><img src="https://via.placeholder.com/400x250.png?text=Node.js+Docs" width="100%" style="border-radius:10px"></td>
    </tr>
    <tr>
      <td align="center"><em>Home Navigation Hub</em></td>
      <td align="center"><em>Task Management UI</em></td>
      <td align="center"><em>Learning Resources</em></td>
    </tr>
  </table>
</div>

## 🔧 Installation Guide

<details open>
<summary><b>Basic Setup</b></summary>

```bash
# Clone repository
git clone https://github.com/yourusername/nodejs-task-manager.git

# Navigate to project directory
cd nodejs-task-manager

# Install dependencies (none required! 🎉)
# Start development server
node server.js
</details><details> <summary><b>Advanced Setup</b></summary>
bash
# Run with custom port
PORT=4000 node server.js

# Generate initial tasks.json
echo '[]' > tasks.json

# Run in background with PM2 (optional)
pm2 start server.js --name "task-manager"
</details>
4. 📚 API Documentation
http
GET /api/tasks
Response

json
[
  {
    "id": 1,
    "title": "Buy groceries",
    "createdAt": "2023-08-20T12:34:56Z"
  }
]
<div class="api-table"> <table> <tr> <th>Method</th> <th>Endpoint</th> <th>Description</th> <th>Status Codes</th> </tr> <tr> <td><code>GET</code></td> <td><code>/api/tasks</code></td> <td>Retrieve all tasks</td> <td>200 ✅, 404 ❌</td> </tr> <tr> <td><code>POST</code></td> <td><code>/api/tasks</code></td> <td>Create new task</td> <td>201 ✨, 400 ⚠️</td> </tr> <tr> <td><code>DELETE</code></td> <td><code>/api/tasks/:id</code></td> <td>Remove task</td> <td>204 🗑️, 404 ❌</td> </tr> </table> </div>
5. 🏗 System Architecture
text
█████████████████████████████████████████████
█          Client-Side (Browser)           █
█████████████████████████████████████████████
       ▲               │               ▲
       │ JSON          │ HTML/CSS/JS   │
       ▼               │               ▼
█████████████████████████████████████████████
█          Node.js Server (v18.x)         █
█  ┌──────────┐        ┌──────────┐      █
█  │ HTTP     │        │ FS       │      █
█  │ Module   ├───────►│ Module   │      █
█  └──────────┘        └──────────┘      █
█████████████████████████████████████████████
       ▲                         ▲
       │ JSON                    │
       ▼                         ▼
█████████████████████████████████████████████
█          Data Storage Layer              █
█  ┌─────────────────────────────────────┐ █
█  │ tasks.json                          │ █
█  │ { tasks: [...] }                   │ █
█  └─────────────────────────────────────┘ █
█████████████████████████████████████████████
6. 👥 Contributing Guide
Fork the repository

Create feature branch:

bash
git checkout -b feat/amazing-feature
Commit changes:

bash
git commit -m "feat: add amazing feature"
Push to branch:

bash
git push origin feat/amazing-feature
Open Pull Request

<div align="center"> <img src="https://img.shields.io/github/contributors/yourusername/nodejs-task-manager?color=purple&label=Contributors" alt="Contributors"> <img src="https://img.shields.io/github/issues/yourusername/nodejs-task-manager?color=green" alt="Open Issues"> </div>
7. ❓ Frequently Asked Questions
<details> <summary>How to handle CORS issues?</summary> <br> Our server already includes CORS headers:
javascript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Content-Type', 'application/json');
</details><details> <summary>Where is data stored?</summary> <br> Tasks persist in <code>tasks.json</code> using Node.js FS module. For production use, consider switching to a proper database. </details><div align="center" style="margin-top: 50px;"> <img src="https://forthebadge.com/images/badges/built-with-love.svg" height="28"> <img src="https://forthebadge.com/images/badges/made-with-javascript.svg" height="28"> </div>
<div align="center"> <h3>📜 License</h3> <p>ISC Licensed • © 2023 Your Name</p> <a href="https://github.com/yourusername/nodejs-task-manager/blob/main/LICENSE"> <img src="https://img.shields.io/badge/License-ISC-blue.svg" alt="License"> </a> </div> ``
