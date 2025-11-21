// backend/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { generateDuty, applySuperviseUpdate } = require("./dutyGenerator");
// ====================
// 监督记录提交接口
// ====================

const app = express();
app.use(cors());
app.use(express.json());

// 上传临时文件配置
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// ====================
// 1️⃣ 托管前端静态文件
// ====================
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));

app.use((req, res, next) => {
  // 如果请求是 API，直接放行
  const apiPrefixes = [
    "/generate-duty",
    "/upload-members",
    "/download-members"
  ];
  
  // 如果是 API，就放行
  if (apiPrefixes.some(prefix => req.path.startsWith(prefix))) {
    return next();
  }
  
  res.sendFile(path.join(frontendPath, "index.html"));
});


// ====================
// 2️⃣ 上传名单接口
// ====================
app.post("/upload-members", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) throw new Error("没有上传文件");

    let members = [];

    // 判断文件类型
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

    // 保存成员到成员文件
    const memberPath = path.join(__dirname, "members.json");
    fs.writeFileSync(memberPath, JSON.stringify(members, null, 2), "utf-8");

    res.json({ count: members.length, members });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ====================
// 3️⃣ 导出当前名单
// ====================
app.get("/download-members", (req, res) => {
  const filePath = path.join(__dirname, "members.json");
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "members.json 文件不存在" });
  }
  res.download(filePath, "members.json");
});

// ====================
// 4️⃣ 生成值日名单
// ====================
app.post("/generate-duty", (req, res) => {
  try {
    const { days, peoplePerDay, startDate } = req.body;
    const result = generateDuty(days, peoplePerDay, startDate);
    res.json({ days: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/submit-supervise", (req, res) => {
  try {
    const { group, finished, cleanScore, comment } = req.body;

    if (!group || !Array.isArray(group) || group.length === 0) {
      return res.status(400).json({ error: "group 为空" });
    }

    // 给该组每个成员记录监督
    group.forEach(name => {
      applySuperviseUpdate(name, cleanScore);
    });

    res.json({ message: "监督记录成功" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ====================
// 启动服务器
// ====================
app.listen(3000, () => {
  console.log("✅ 值日通后端已启动：http://localhost:3000");
});
