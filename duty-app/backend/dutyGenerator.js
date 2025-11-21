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

// 生成值日名单（带自动清空历史）
function generateDuty(days, peoplePerDay, startDate) {
  let members = readJSON(memberPath, []);
  let history = readJSON(historyPath, []);

  // 筛选可用成员
  let available = members.filter(m => m.可用 === 1);
  if (available.length < peoplePerDay) {
    throw new Error(`可用成员不足：当前可用人数 ${available.length}，但每天需要 ${peoplePerDay} 人。`);
  }

  // 计算平均能力
  const avgAbility = available.reduce((s, m) => s + m.能力, 0) / available.length;

  function groupScore(group) {
    const names = group.map(m => m.name);
    // 检查是否在历史中
    const usedBefore = history.some(h => names.every(n => h.includes(n)) && h.length === names.length);
    if (usedBefore) return null;

    const avg = group.reduce((s, m) => s + m.能力, 0) / group.length;
    const abilityScore = Math.max(0, 10 - Math.abs(avg - avgAbility) * 2);
    const fairness = group.reduce((s, m) => s + (10 - m.次数), 0);
    const randomness = Math.random() * 2 - 1;
    return abilityScore + fairness + randomness;
  }

  const result = [];

  for (let d = 0; d < days; d++) {
    let combos = [];

    // 生成所有可能组合
    for (let i = 0; i < available.length; i++) {
      for (let j = i + 1; j < available.length; j++) {
        const group = [available[i], available[j]];
        const score = groupScore(group);
        if (score !== null) combos.push({ group, score });
      }
    }

    // ✅ 如果没有合法组合，自动清空历史并重新生成
    if (combos.length === 0) {
      console.log("⚠️ 所有组合均已出现，清空历史记录并重新开始...");
      history = [];
      writeJSON(historyPath, history);

      // 重新计算一次组合
      for (let i = 0; i < available.length; i++) {
        for (let j = i + 1; j < available.length; j++) {
          const group = [available[i], available[j]];
          const score = groupScore(group);
          if (score !== null) combos.push({ group, score });
        }
      }

      // 如果依然没有，说明成员太少
      if (combos.length === 0) {
        throw new Error("即使清空历史后仍无法生成组合，请检查成员人数或数据。");
      }
    }

    combos.sort((a, b) => b.score - a.score);
    const topN = Math.max(1, Math.floor(combos.length / 10));
    const chosen = combos[Math.floor(Math.random() * topN)];

    const names = chosen.group.map(m => m.name);
    history.push(names);
    result.push({
      date: new Date(new Date(startDate).getTime() + d * 86400000)
        .toISOString()
        .split("T")[0],
      group: names
    });

    // 更新次数
    members.forEach(m => {
      if (names.includes(m.name)) m.次数 += 1;
    });
  }

  writeJSON(memberPath, members);
  writeJSON(historyPath, history);
// ============================
// 🌟 新增：监督系统数据处理函数
// ============================
const supervisePath = path.join(__dirname, "supervise.json");

// 新增：应用监督评分到成员能力
function applySuperviseUpdate(name, cleanScore) {
  let members = readJSON(memberPath, []);
  let supervise = readJSON(supervisePath, []);

  const m = members.find(x => x.name === name);
  if (!m) return;

  // 记录监督结果
  supervise.push({
    name,
    cleanScore,
    time: new Date().toISOString()
  });

  // 调整能力：整洁度中位数 5 为基准，上下浮动能力
  m.能力 = Math.min(10, Math.max(1, m.能力 + (cleanScore - 5) * 0.2));

  writeJSON(memberPath, members);
  writeJSON(supervisePath, supervise);
}

  return result;
}

// ============================
// 🌟 新增：监督系统数据处理函数
// ============================

function applySuperviseUpdate(name, cleanScore) {
  let members = readJSON(memberPath, []);
  let supervise = readJSON(supervisePath, []);

  const m = members.find(x => x.name === name);
  if (!m) return;

  // 写入监督记录
  supervise.push({
    name,
    cleanScore,
    time: new Date().toISOString()
  });

  // 整洁度影响能力值（能力封顶10，不低于1）
  m.能力 = Math.min(10, Math.max(1, m.能力 + (cleanScore - 5) * 0.2));

  writeJSON(memberPath, members);
  writeJSON(supervisePath, supervise);
}

module.exports = { generateDuty, applySuperviseUpdate };

