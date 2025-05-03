const http = require('http');
const fs = require('fs');
const url = require('url');
const path = require('path');

// File to store tasks (simulate a database)
const TASKS_FILE = 'tasks.json';

// Helper function to read tasks
function readTasks(callback) {
  fs.readFile(TASKS_FILE, 'utf8', (err, data) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // File doesn't exist yet; return empty array
        callback([]);
      } else {
        callback(null, err);
      }
    } else {
      callback(JSON.parse(data));
    }
  });
}

// Helper function to write tasks
function writeTasks(tasks, callback) {
  fs.writeFile(TASKS_FILE, JSON.stringify(tasks), callback);
}

// Create HTTP server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Set CORS headers (allow frontend access)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  // Handle API routes
  if (pathname === '/api/tasks') {
    if (req.method === 'GET') {
      // GET all tasks
      readTasks((tasks) => {
        res.end(JSON.stringify(tasks));
      });
    } else if (req.method === 'POST') {
      // POST a new task
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        const newTask = JSON.parse(body);
        readTasks((tasks) => {
          newTask.id = tasks.length + 1;
          tasks.push(newTask);
          writeTasks(tasks, () => {
            res.end(JSON.stringify(newTask));
          });
        });
      });
    }
  } else if (pathname.startsWith('/api/tasks/') && req.method === 'DELETE') {
    // DELETE a task by ID
    const taskId = parseInt(pathname.split('/')[3]);
    readTasks((tasks) => {
      const filteredTasks = tasks.filter(task => task.id !== taskId);
      writeTasks(filteredTasks, () => {
        res.end(JSON.stringify({ success: true }));
      });
    });
  } else {
    // Serve static files (frontend)
    const filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end('File not found');
      } else {
        const ext = path.extname(filePath);
        const ContentType = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json'
        }[ext]

        res.setHeader('Content-Type', ContentType);
        res.end(data);

      }
    });
   
  }
});

// Start server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Pure Node.js server running on http://localhost:${PORT}`);
});