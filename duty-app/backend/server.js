// backend/server.js
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const { generateDuty, applySuperviseUpdate } = require("./dutyGenerator");

const app = express();
app.use(cors());
app.use(express.json());

// ===== 静态文件托管 =====
const frontendPath = path.join(__dirname, "../frontend");
app.use(express.static(frontendPath));
app.get("/", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// 上传配置
const upload = multer({ dest: path.join(__dirname, "uploads/") });

// ---------- 上传名单 ----------
app.post("/upload-members", upload.single("file"), (req, res) => {
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

    const memberPath = path.join(__dirname, "members.json");
    fs.writeFileSync(memberPath, JSON.stringify(members, null, 2), "utf-8");

    res.json({ count: members.length, members });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 导出当前名单 ----------
app.get("/download-members", (req, res) => {
  const filePath = path.join(__dirname, "members.json");
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "members.json 文件不存在" });
  }
  res.download(filePath, "members.json");
});

// ---------- 生成值日计划 ----------
app.post("/generate-duty", (req, res) => {
  try {
    const { days, peoplePerDay, startDate } = req.body;
    const result = generateDuty(days, peoplePerDay, startDate);
    res.json({ days: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 新增：监督记录 ----------
const superviseFile = path.join(__dirname, "supervise.json");
if (!fs.existsSync(superviseFile)) fs.writeFileSync(superviseFile, "[]", "utf-8");

function readJSON(file, def = []) {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); }
  catch { return def; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
}

/*
{
  date: "...",
  group: [...],
  comment: "...",
  individuals: [
    { name:"小明",completed:1,score:8,comment:"" }
  ]
}
*/

app.post("/submit-supervise", (req, res) => {
  try {
    const body = req.body;
    if (!body.date || !Array.isArray(body.group) || !Array.isArray(body.individuals)) {
      return res.status(400).json({ error: "请求体缺少 date/group/individuals" });
    }

    const records = readJSON(superviseFile, []);
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
    writeJSON(superviseFile, filtered);

    newRecord.individuals.forEach(p => {
      try { applySuperviseUpdate(p.name, p.score !== null ? p.score : (p.completed ? 6 : 4)); }
      catch {}
    });

    res.json({ ok: true, record: newRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 按日期获取监督记录 ----------
app.get("/get-supervise", (req, res) => {
  try {
    const date = req.query.date;
    if (!date) return res.json({ found: false });

    const records = readJSON(superviseFile, []);
    const found = records.find(r => r.date === date);
    if (!found) return res.json({ found: false });

    res.json({ found: true, record: found });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 新增：更新到下一周 ----------
app.post("/update-week", (req, res) => {
  try {
    const members = readJSON(path.join(__dirname, "members.json"), []);
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "members.json 数据无效" });
    }

    const newMembers = members.map(m => ({
      name: m.name,
      能力: m.能力,
      可用: m.可用,
      次数: m.次数
    }));

    writeJSON(path.join(__dirname, "members.json"), newMembers);

    res.json({ ok: true, members: newMembers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- 启动服务器 ----------
app.listen(3000, () => {
  console.log("✅ 值日通后端已启动：http://localhost:3000");
});
