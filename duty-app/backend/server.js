// backend/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const crypto = require("crypto");

const { generateDuty, applySuperviseUpdate } = require("./dutyGenerator");

const app = express();
app.use(cors());
app.use(express.json());

// ===== 静态文件托管 =====
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

// 根目录重定向到 dashboard (前端会判断登录状态)
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// ===== 数据存储配置 =====
const DATA_ROOT = path.join(__dirname, "../data");
const USERS_FILE = path.join(DATA_ROOT, "users.json");

if (!fs.existsSync(DATA_ROOT)) fs.mkdirSync(DATA_ROOT, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]", "utf-8");

// 简单的内存 Session 存储 (Token -> Username)
const sessions = {};

// 辅助：读写用户数据
function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf-8")); }
  catch { return []; }
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

// 辅助：获取用户根目录
function getUserRootDir(username) {
  const dir = path.join(DATA_ROOT, username);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Helper: Get User's Class Directory (Handles Shared Classes)
function getClassDir(username, classId) {
  // Check if it's a shared class mapping
  // A shared class name generally looks like "[Shared] className (@owner)" or we can strictly use the mapped ID if we passed it.
  // BUT frontend passes "currentClassId" which is the NAME.
  // To resolve correctly, we need to check shared_classes.json for THIS user.

  const userRoot = getUserRootDir(username);
  const sharedFile = path.join(userRoot, "shared_classes.json");
  if (fs.existsSync(sharedFile)) {
    try {
      const shared = JSON.parse(fs.readFileSync(sharedFile, "utf-8"));
      const link = shared.find(s => s.name === classId);
      if (link) {
        // It is a shared class! Redirect to OWNER's data.
        const ownerRoot = getUserRootDir(link.owner);

        // We must assume the owner's class dir logic is same:
        // Safe name logic:
        const safeOwnerClassId = link.originalClassId.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "");
        const targetDir = path.join(ownerRoot, safeOwnerClassId);
        if (!fs.existsSync(targetDir)) throw new Error("Shared class not found (Owner may have deleted it)");
        return targetDir;
      }
    } catch (e) { console.error("Shared resolution error", e); }
  }

  // Fallback to local class
  const safeClassId = (classId || "default").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, "");
  const classDir = path.join(userRoot, safeClassId);
  if (!fs.existsSync(classDir)) {
    fs.mkdirSync(classDir, { recursive: true });
  }
  return classDir;
}

// 辅助：获取文件路径 (支持多班级)
function getUserFilePaths(username, classId) {
  const dir = getClassDir(username, classId);
  return {
    memberPath: path.join(dir, "members.json"),
    historyPath: path.join(dir, "history.json"),
    supervisePath: path.join(dir, "supervise.json"),
    schedulePath: path.join(dir, "schedule.json"),
    collaboratorsPath: path.join(dir, "collaborators.json"),
    auditPath: path.join(dir, "audit.json")
  };
}

// 辅助：记录审计日志
function logAction(username, classId, action, details = "") {
  try {
    const { auditPath } = getUserFilePaths(username, classId);
    let logs = [];
    try { logs = JSON.parse(fs.readFileSync(auditPath, "utf-8")); } catch { }

    logs.unshift({
      user: username,
      action,
      details,
      time: new Date().toISOString()
    });

    // Keep last 100 logs
    if (logs.length > 100) logs = logs.slice(0, 100);

    fs.writeFileSync(auditPath, JSON.stringify(logs, null, 2), "utf-8");
  } catch (e) {
    console.error("Audit Log Error:", e);
  }
}

// ===== 认证接口 =====

app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "请输入用户名和密码" });

  const users = readUsers();
  if (users.find(u => u.username === username)) {
    return res.status(400).json({ error: "用户名已存在" });
  }

  // 简单存储（生产环境应加盐哈希）
  users.push({ username, password });
  writeUsers(users);

  // 初始化用户目录
  getUserRootDir(username);

  res.json({ ok: true });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
  const user = users.find(u => u.username === username && u.password === password);

  if (!user) return res.status(401).json({ error: "用户名或密码错误" });

  // 生成简单 Token
  const token = crypto.randomBytes(16).toString("hex");
  sessions[token] = username;

  res.json({ ok: true, token, username });
});

app.post("/api/logout", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (token) delete sessions[token];
  res.json({ ok: true });
});

// ===== 中间件：验证 Token =====
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "未登录" });

  const token = authHeader.split(" ")[1];
  const username = sessions[token];

  if (!username) return res.status(401).json({ error: "登录已失效" });

  req.user = { username };
  // 从 Header 获取当前班级 ID
  req.classId = decodeURIComponent(req.headers["x-class-id"] || "default");
  next();
}

// ===== 班级管理接口 =====

// 获取班级列表
app.get("/api/class/list", authMiddleware, (req, res) => {
  try {
    const userDir = getUserRootDir(req.user.username);
    const items = fs.readdirSync(userDir, { withFileTypes: true });
    const classes = items
      .filter(item => item.isDirectory())
      .map(item => item.name);

    // 如果没有班级，默认创建一个 default
    if (classes.length === 0) {
      getClassDir(req.user.username, "default");
      classes.push("default");
    }

    res.json({ classes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建新班级
app.post("/api/class/create", authMiddleware, (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "请输入班级名称" });

    const classDir = getClassDir(req.user.username, name);
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 业务接口 (需认证) =====

// 上传配置
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// 上传名单
app.post("/upload-members", authMiddleware, upload.single("file"), (req, res) => {
  try {
    const file = req.file;
    if (!file) throw new Error("没有上传文件");

    let members = [];

    if (file.originalname.endsWith(".json")) {
      const text = fs.readFileSync(file.path, "utf-8");
      members = JSON.parse(text);
    } else if (file.originalname.endsWith(".xlsx") || file.originalname.endsWith(".csv")) {
      const workbook = XLSX.readFile(file.path);
      const sheetName = workbook.SheetNames[0];
      members = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      throw new Error("仅支持 JSON、Excel 或 CSV 文件");
    }

    // 自动补全字段
    members = members.map(m => ({
      name: m.name || m.姓名 || "未知",
      能力: m.能力 !== undefined ? m.能力 : 5,
      可用: m.可用 !== undefined ? m.可用 : 1,
      次数: m.次数 !== undefined ? m.次数 : 0
    }));

    const { memberPath } = getUserFilePaths(req.user.username, req.classId);
    fs.writeFileSync(memberPath, JSON.stringify(members, null, 2), "utf-8");

    res.json({ count: members.length, members });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 导出当前名单
app.get("/download-members", (req, res) => {
  const token = req.query.token;
  const classId = req.query.classId || "default";
  const username = sessions[token];

  if (!username) return res.status(401).send("未登录");

  const { memberPath } = getUserFilePaths(username, classId);
  if (!fs.existsSync(memberPath)) {
    return res.status(404).send("尚未上传名单");
  }
  res.download(memberPath, "members.json");
});

// 获取成员列表 (Preview)
app.get("/api/class/members", authMiddleware, (req, res) => {
  try {
    const { memberPath } = getUserFilePaths(req.user.username, req.classId);
    let members = [];
    try { members = JSON.parse(fs.readFileSync(memberPath, "utf-8")); } catch { }
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 生成值日计划
app.post("/generate-duty", authMiddleware, (req, res) => {
  try {
    const { days, peoplePerDay, startDate, roles } = req.body;
    const paths = getUserFilePaths(req.user.username, req.classId);
    const result = generateDuty(days, peoplePerDay, startDate, paths, roles);

    // 保存排班表到 schedule.json
    let schedule = [];
    try { schedule = JSON.parse(fs.readFileSync(paths.schedulePath, "utf-8")); } catch { }

    // 合并/覆盖新生成的日期
    result.forEach(newItem => {
      const idx = schedule.findIndex(s => s.date === newItem.date);
      if (idx >= 0) schedule[idx] = newItem;
      else schedule.push(newItem);
    });

    // 按日期排序
    schedule.sort((a, b) => new Date(a.date) - new Date(b.date));
    fs.writeFileSync(paths.schedulePath, JSON.stringify(schedule, null, 2), "utf-8");

    res.json({ days: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 获取排班表 (用于日历)
app.get("/api/schedule", authMiddleware, (req, res) => {
  try {
    const { schedulePath } = getUserFilePaths(req.user.username, req.classId);
    let schedule = [];
    try { schedule = JSON.parse(fs.readFileSync(schedulePath, "utf-8")); } catch { }
    res.json({ schedule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 提交监督
app.post("/submit-supervise", authMiddleware, (req, res) => {
  try {
    const body = req.body;
    if (!body.date || !Array.isArray(body.group) || !Array.isArray(body.individuals)) {
      return res.status(400).json({ error: "请求体缺少 date/group/individuals" });
    }

    const { supervisePath } = getUserFilePaths(req.user.username, req.classId);

    let records = [];
    try { records = JSON.parse(fs.readFileSync(supervisePath, "utf-8")); } catch { }

    const filtered = records.filter(r => r.date !== body.date);

    const newRecord = {
      date: body.date,
      group: body.group,
      comment: body.comment || "",
      individuals: body.individuals.map(p => ({
        name: p.name,
        completed: Number(p.completed) ? 1 : 0,
        score: p.score !== undefined ? Number(p.score) : null,
        comment: p.comment || ""
      })),
      updatedAt: new Date().toISOString()
    };

    filtered.push(newRecord);
    fs.writeFileSync(supervisePath, JSON.stringify(filtered, null, 2), "utf-8");

    // 更新能力值
    const paths = getUserFilePaths(req.user.username, req.classId);
    newRecord.individuals.forEach(p => {
      try { applySuperviseUpdate(p.name, p.score !== null ? p.score : (p.completed ? 6 : 4), paths); }
      catch { }
    });

    res.json({ ok: true, record: newRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取监督记录
app.get("/get-supervise", authMiddleware, (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.json({ found: false });

    const { supervisePath } = getUserFilePaths(req.user.username, req.classId);
    let records = [];
    try { records = JSON.parse(fs.readFileSync(supervisePath, "utf-8")); } catch { }

    const found = records.find(r => r.date === date);
    if (!found) return res.json({ found: false });

    res.json({ found: true, record: found });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新到下一周
app.post("/update-week", authMiddleware, (req, res) => {
  try {
    const { memberPath } = getUserFilePaths(req.user.username, req.classId);
    let members = [];
    try { members = JSON.parse(fs.readFileSync(memberPath, "utf-8")); } catch { }

    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "数据无效" });
    }

    const newMembers = members.map(m => ({
      name: m.name,
      能力: m.能力,
      可用: m.可用,
      次数: m.次数
    }));

    fs.writeFileSync(memberPath, JSON.stringify(newMembers, null, 2), "utf-8");

    res.json({ ok: true, members: newMembers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 总结模块 API =====
app.get("/api/summary", authMiddleware, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: "请提供开始和结束日期" });

    const { supervisePath } = getUserFilePaths(req.user.username, req.classId);
    let records = [];
    try { records = JSON.parse(fs.readFileSync(supervisePath, "utf-8")); } catch { }

    // 筛选日期范围
    const start = new Date(startDate);
    const end = new Date(endDate);
    const filtered = records.filter(r => {
      const d = new Date(r.date);
      return d >= start && d <= end;
    });

    // 统计数据
    let totalScore = 0;
    let totalCount = 0;
    const individualStats = {};

    filtered.forEach(r => {
      r.individuals.forEach(p => {
        if (!individualStats[p.name]) individualStats[p.name] = { score: 0, count: 0 };
        if (p.score !== null) {
          individualStats[p.name].score += p.score;
          individualStats[p.name].count += 1;
          totalScore += p.score;
          totalCount += 1;
        }
      });
    });

    // 寻找最佳个人 (平均分最高)
    let bestIndividual = null;
    let maxAvg = -1;
    Object.keys(individualStats).forEach(name => {
      const s = individualStats[name];
      if (s.count > 0) {
        const avg = s.score / s.count;
        if (avg > maxAvg) {
          maxAvg = avg;
          bestIndividual = { name, avg: avg.toFixed(1) };
        }
      }
    });

    res.json({
      range: { startDate, endDate },
      totalDays: filtered.length,
      avgScore: totalCount > 0 ? (totalScore / totalCount).toFixed(1) : 0,
      bestIndividual,
      records: filtered
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 排班编辑/预览接口 =====

// 预览排班 (不保存)
app.post("/api/duty/preview", authMiddleware, (req, res) => {
  try {
    const { days, peoplePerDay, startDate, roles, strategy } = req.body;
    const paths = getUserFilePaths(req.user.username, req.classId);
    // dryRun = true
    const result = generateDuty(days, peoplePerDay, startDate, paths, roles, true, strategy);
    res.json({ days: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 保存排班 (从预览确认)
app.post("/api/schedule/save-batch", authMiddleware, (req, res) => {
  try {
    const { newSchedule } = req.body; // Array of { date, group }
    if (!Array.isArray(newSchedule)) return res.status(400).json({ error: "Invalid schedule data" });

    const paths = getUserFilePaths(req.user.username, req.classId);
    let schedule = [];
    try { schedule = JSON.parse(fs.readFileSync(paths.schedulePath, "utf-8")); } catch { }
    let members = [];
    try { members = JSON.parse(fs.readFileSync(paths.memberPath, "utf-8")); } catch { }
    let history = [];
    try { history = JSON.parse(fs.readFileSync(paths.historyPath, "utf-8")); } catch { }

    newSchedule.forEach(item => {
      // Update Schedule
      const idx = schedule.findIndex(s => s.date === item.date);
      if (idx >= 0) schedule[idx] = item;
      else schedule.push(item);

      // Extract names
      const names = item.group.map(g => typeof g === 'string' ? g : g.name);

      // Update History
      history.push(names);

      // Update Member Counts
      names.forEach(name => {
        const m = members.find(u => u.name === name);
        if (m) m.次数 = (m.次数 || 0) + 1;
      });
    });

    schedule.sort((a, b) => new Date(a.date) - new Date(b.date));

    fs.writeFileSync(paths.schedulePath, JSON.stringify(schedule, null, 2), "utf-8");
    fs.writeFileSync(paths.memberPath, JSON.stringify(members, null, 2), "utf-8");
    fs.writeFileSync(paths.historyPath, JSON.stringify(history, null, 2), "utf-8");

    logAction(req.user.username, req.classId, "GENERATE", `Generated/Saved ${newSchedule.length} days of duty.`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新某天排班 (编辑组/人)
app.post("/api/schedule/update", authMiddleware, (req, res) => {
  try {
    const { date, group } = req.body;
    // group: [{name, role}, ...]
    if (!date || !group) return res.status(400).json({ error: "Missing date or group" });

    const paths = getUserFilePaths(req.user.username, req.classId);
    let schedule = [];
    try { schedule = JSON.parse(fs.readFileSync(paths.schedulePath, "utf-8")); } catch { }

    // We do NOT update member counts here for simplicity (manual edit assumes manual control)
    // Or we could try to diff... let's stick to just updating the schedule for now.

    const idx = schedule.findIndex(s => s.date === date);
    if (idx >= 0) {
      schedule[idx].group = group;

      // If we want to strictly sync history, we might need to update history.json too?
      // But matching history records to dates is hard (history is just a list).
      // Let's assume history is append-only logs for generation and doesn't need strict sync with edits.
    } else {
      schedule.push({ date, group });
    }

    schedule.sort((a, b) => new Date(a.date) - new Date(b.date));
    fs.writeFileSync(paths.schedulePath, JSON.stringify(schedule, null, 2), "utf-8");

    logAction(req.user.username, req.classId, "UPDATE", `Updated duty for ${date}.`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 移动排班 (日历拖拽)
app.post("/api/schedule/move", authMiddleware, (req, res) => {
  try {
    const { fromDate, toDate } = req.body;
    if (!fromDate || !toDate) return res.status(400).json({ error: "Missing dates" });

    const paths = getUserFilePaths(req.user.username, req.classId);
    let schedule = [];
    try { schedule = JSON.parse(fs.readFileSync(paths.schedulePath, "utf-8")); } catch { }

    const fromIdx = schedule.findIndex(s => s.date === fromDate);
    const toIdx = schedule.findIndex(s => s.date === toDate);

    if (fromIdx === -1) return res.status(404).json({ error: "Source date not found" });

    const fromItem = schedule[fromIdx];

    if (toIdx !== -1) {
      // Swap
      const toItem = schedule[toIdx];
      const tempGroup = fromItem.group;
      fromItem.group = toItem.group;
      toItem.group = tempGroup;
      // We keep dates as is, just swap content
    } else {
      // Move to empty slot
      // Remove from old
      schedule.splice(fromIdx, 1);
      // Add to new
      schedule.push({ date: toDate, group: fromItem.group });
    }

    schedule.sort((a, b) => new Date(a.date) - new Date(b.date));
    fs.writeFileSync(paths.schedulePath, JSON.stringify(schedule, null, 2), "utf-8");

    logAction(req.user.username, req.classId, "MOVE", `Moved duty from ${fromDate} to ${toDate}.`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 全局状态 API (Global Dashboard) =====
app.get("/api/user/status", authMiddleware, (req, res) => {
  try {
    const userDir = getUserRootDir(req.user.username);
    const items = fs.readdirSync(userDir, { withFileTypes: true });

    // Local Classes
    let classList = items
      .filter(item => item.isDirectory())
      .map(item => ({ name: item.name, isShared: false, owner: req.user.username }));

    // Shared Classes
    try {
      const sharedPath = path.join(userDir, "shared_classes.json");
      if (fs.existsSync(sharedPath)) {
        const shared = JSON.parse(fs.readFileSync(sharedPath, "utf-8"));
        // Add shared to list
        classList = classList.concat(shared.map(s => ({
          name: s.name, // Display Name
          isShared: true,
          owner: s.owner,
          realDir: getClassDir(req.user.username, s.name) // Resolve true path for checking status
        })));
      }
    } catch (e) { }

    const statusList = classList.map(cls => {
      let schedule = [], supervise = [];
      const dir = cls.isShared ? cls.realDir : path.join(userDir, cls.name);

      try {
        if (fs.existsSync(path.join(dir, "schedule.json")))
          schedule = JSON.parse(fs.readFileSync(path.join(dir, "schedule.json"), "utf-8"));
        if (fs.existsSync(path.join(dir, "supervise.json")))
          supervise = JSON.parse(fs.readFileSync(path.join(dir, "supervise.json"), "utf-8"));
      } catch { }

      const today = new Date().toISOString().split("T")[0];
      const todayDuty = schedule.find(s => s.date === today);

      // Pending Duty: Today has duty AND not fully supervised (score given)
      // Check if today's duty has a record in supervise.json
      const isSupervised = supervise.some(r => r.date === today);
      const pendingDuty = !!todayDuty && !isSupervised;

      // Check Next Week
      // Simplified: Check if schedule has dates > today + 7
      const nextWeekDate = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
      const nextWeekReady = schedule.some(s => s.date >= nextWeekDate);

      return {
        name: cls.name,
        pendingDuty,
        nextWeekReady,
        todayDutyGroup: todayDuty ? todayDuty.group : null,
        isShared: cls.isShared
      };
    });

    res.json({ classes: statusList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 用户设置 API =====
app.post("/api/user/update", authMiddleware, (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Password required" });

    const users = readUsers();
    const user = users.find(u => u.username === req.user.username);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.password = password;
    writeUsers(users);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/user/delete", authMiddleware, (req, res) => {
  try {
    const users = readUsers();
    const idx = users.findIndex(u => u.username === req.user.username);
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    // Remove user entry
    users.splice(idx, 1);
    writeUsers(users);

    // Remove data folder
    const userDir = getUserRootDir(req.user.username);
    if (fs.existsSync(userDir)) fs.rmdirSync(userDir, { recursive: true });

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 班级协作 API =====
const INVITE_FILE = path.join(DATA_ROOT, "invites.json");
function loadInvites() {
  try { return JSON.parse(fs.readFileSync(INVITE_FILE, "utf-8")); } catch { return {}; }
}
function saveInvites(data) {
  fs.writeFileSync(INVITE_FILE, JSON.stringify(data, null, 2));
}

// 生成邀请码 (Owner only)
app.post("/api/class/invite", authMiddleware, (req, res) => {
  try {
    // Generate random code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const invites = loadInvites();

    // Store mapping: Code -> { owner, classId }
    invites[code] = { owner: req.user.username, classId: req.classId };
    saveInvites(invites);

    res.json({ code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 加入班级
app.post("/api/class/join", authMiddleware, (req, res) => {
  try {
    const { code } = req.body;
    const invites = loadInvites();
    const invite = invites[code];

    if (!invite) return res.status(404).json({ error: "Invalid invite code" });
    if (invite.owner === req.user.username) return res.status(400).json({ error: "Cannot join your own class" });

    // Add to user's "Shared Classes" list
    // We store this in a special file: `data/<user>/shared_classes.json`
    const sharedFile = path.join(getUserRootDir(req.user.username), "shared_classes.json");
    let shared = [];
    try { shared = JSON.parse(fs.readFileSync(sharedFile, "utf-8")); } catch { }

    // Check duplicate
    if (shared.some(s => s.owner === invite.owner && s.classId === invite.classId)) {
      return res.status(400).json({ error: "Already joined this class" });
    }

    shared.push({
      name: `[Shared] ${invite.classId} (@${invite.owner})`,
      originalClassId: invite.classId,
      owner: invite.owner
    });
    fs.writeFileSync(sharedFile, JSON.stringify(shared, null, 2));

    // Update Collaborators List in OWNER'S directory
    try {
      const { collaboratorsPath } = getUserFilePaths(invite.owner, invite.classId);
      let collaborators = [];
      try { collaborators = JSON.parse(fs.readFileSync(collaboratorsPath, "utf-8")); } catch { }

      if (!collaborators.find(c => c.username === req.user.username)) {
        collaborators.push({
          username: req.user.username,
          joinedAt: new Date().toISOString()
        });
        fs.writeFileSync(collaboratorsPath, JSON.stringify(collaborators, null, 2), "utf-8");
      }

      // Log Audit
      logAction(invite.owner, invite.classId, "JOIN", `User ${req.user.username} joined the class.`);
    } catch (e) { console.error("Track collaborator failed", e); }

    res.json({ ok: true, className: `[Shared] ${invite.classId} (@${invite.owner})` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取协作信息 (Collaborators, Logs, InviteCode)
app.get("/api/class/collaboration", authMiddleware, (req, res) => {
  try {
    const { collaboratorsPath, auditPath } = getUserFilePaths(req.user.username, req.classId);

    // 1. Collaborators
    let collaborators = [];
    try { collaborators = JSON.parse(fs.readFileSync(collaboratorsPath, "utf-8")); } catch { }

    // 2. Audit Logs
    let auditLog = [];
    try { auditLog = JSON.parse(fs.readFileSync(auditPath, "utf-8")); } catch { }

    // 3. Invite Code (Find code for this class if exists)
    // This is slow if invites.json is huge, but fine for now.
    const invites = loadInvites();
    // In shared class scenario, req.classId is the NAME implies we need to resolve owner.
    // But getUserFilePaths resolves owner internally.
    // However, invites store { owner, classId } based on ORIGINAL creation.
    // If I am VIEWING a shared class, I might not be able to generate invite code unless I am owner?
    // Requirement says: "In class page show invite code".
    // If shared, maybe show "Joined via xxx"? Or just hide?
    // Let's Find any code that points to this class.

    // We need to know who is the REAL owner to find the invite code.
    // getUserFilePaths logic:
    // If I am owner, owner=me, classId=name.
    // If shared, owner=other, classId=originalName.

    // Let's just return what we find for THIS user's context?
    // Actually, `getUserFilePaths` doesn't tell us the owner directly.
    // We can infer it from `getClassDir`.

    const dir = getClassDir(req.user.username, req.classId);
    // Warning: getClassDir implementation relies on `shared_classes.json` of REQUESTER.
    // If I am owner, dir is my dir.
    // If I am viewer, dir is owner's dir.

    // We can try to match `dir` with `invites`.
    // But invites store `owner` + `classId`.
    // Let's iterating invites and checking if they match current class context is hard without passing owner info explicitly.

    // Simplification:
    // Return invite code ONLY if I am the owner.
    // How do I know if I am the owner?
    // `getUserFilePaths` -> if shared, it redirects.
    // Let's look at `shared_classes.json` again?

    let inviteCode = null;
    const userRoot = getUserRootDir(req.user.username);
    const sharedFile = path.join(userRoot, "shared_classes.json");
    let isShared = false;
    let realOwner = req.user.username;
    let realClassId = req.classId;

    if (fs.existsSync(sharedFile)) {
      try {
        const shared = JSON.parse(fs.readFileSync(sharedFile, "utf-8"));
        const link = shared.find(s => s.name === req.classId);
        if (link) {
          isShared = true;
          realOwner = link.owner;
          realClassId = link.originalClassId;
        }
      } catch { }
    }

    if (!isShared) {
      // I am owner, find my code
      for (const [code, info] of Object.entries(invites)) {
        if (info.owner === req.user.username && info.classId === req.classId) {
          inviteCode = code;
          break;
        }
      }
    }

    res.json({
      isShared,
      owner: realOwner,
      role: isShared ? "collaborator" : "owner",
      inviteCode,
      collaborators,
      auditLog
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Start Server
app.listen(3000, () => {
  console.log(`Server running at http://localhost:3000`);
});
