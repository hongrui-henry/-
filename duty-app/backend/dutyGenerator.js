// backend/dutyGenerator.js
const fs = require("fs");
const path = require("path");

const memberPath = path.join(__dirname, "members.json");
const historyPath = path.join(__dirname, "history.json");
const supervisePath = path.join(__dirname, "supervise.json");

// 读取 JSON 文件
function readJSON(filePath, defaultValue = []) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return defaultValue;
  }
}

// 保存 JSON 文件
function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// 生成值日名单（核心逻辑）
function generateDuty(days, peoplePerDay, startDate) {
  let members = readJSON(memberPath, []);
  let history = readJSON(historyPath, []);

  // 筛选可用成员
  let available = members.filter(m => m.可用 === 1);
  if (available.length < peoplePerDay) {
    throw new Error("可用人数不足");
  }

  // 平均能力
  const avgAbility =
    available.reduce((s, m) => s + m.能力, 0) / available.length;

  function groupScore(group) {
    const names = group.map(m => m.name);

    // 完全相同组合不能重复
    if (history.some(h => names.every(n => h.includes(n)) && h.length === names.length)) {
      return null;
    }

    const avg = group.reduce((s, m) => s + m.能力, 0) / group.length;
    const abilityScore = Math.max(0, 10 - Math.abs(avg - avgAbility) * 2);
    const fairness = group.reduce((s, m) => s + (10 - m.次数), 0);
    const randomness = Math.random() * 2 - 1;
    return abilityScore + fairness + randomness;
  }

  const result = [];

  for (let d = 0; d < days; d++) {
    const combos = [];

    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const group = [available[i], available[j]];
        const score = groupScore(group);
        if (score !== null) combos.push({ group, score });
      }
    }

    // 若无可用组合 → 清空历史并重试
    if (combos.length === 0) {
      history = [];
      writeJSON(historyPath, history);

      for (let i = 0; i < available.length; i++) {
        for (let j = i + 1; j < available.length; j++) {
          const group = [available[i], available[j]];
          const score = groupScore(group);
          if (score !== null) combos.push({ group, score });
        }
      }

      if (combos.length === 0) throw new Error("无法生成有效分组");
    }

    combos.sort((a, b) => b.score - a.score);
    const topN = Math.max(1, Math.floor(combos.length / 10));
    const chosen = combos[Math.floor(Math.random() * topN)];

    if (!chosen) throw new Error("无法生成有效分组");

    const names = chosen.group.map(m => m.name);
    history.push(names);

    result.push({
      date: new Date(new Date(startDate).getTime() + d * 86400000)
        .toISOString()
        .split("T")[0],
      group: names
    });

    // 次数增加
    members.forEach(m => {
      if (names.includes(m.name)) m.次数 += 1;
    });
  }

  writeJSON(memberPath, members);
  writeJSON(historyPath, history);

  return result;
}

// ====================
// 监督更新：能力 + 次数 调整
// ====================
function applySuperviseUpdate(name, cleanScore) {
  let members = readJSON(memberPath, []);
  let supervise = readJSON(supervisePath, []);

  const m = members.find(x => x.name === name);
  if (!m) return;

  supervise.push({
    name,
    cleanScore,
    time: new Date().toISOString()
  });

  // 能力调整（整洁度评分 cleanScore ∈ 1~10）
  m.能力 = Math.min(10, Math.max(1, m.能力 + (cleanScore - 5) * 0.25));

  // 次数调整策略
  if (cleanScore >= 8) m.次数 = Math.max(0, m.次数 - 1);
  if (cleanScore <= 3) m.次数 += 1;

  writeJSON(memberPath, members);
  writeJSON(supervisePath, supervise);
}

module.exports = { generateDuty, applySuperviseUpdate };
