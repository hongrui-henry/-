const fs = require("fs");

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

// 辅助：生成组合 (从 arr 中选 k 个)
function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];

  const first = arr[0];
  const rest = arr.slice(1);

  const combsWithFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const combsWithoutFirst = getCombinations(rest, k);

  return [...combsWithFirst, ...combsWithoutFirst];
}

// 生成值日名单（核心逻辑）
function generateDuty(days, peoplePerDay, startDate, filePaths, roles = [], dryRun = false, strategy = 'default') {
  const { memberPath, historyPath } = filePaths;
  let members = readJSON(memberPath, []);
  let history = readJSON(historyPath, []);

  // 筛选可用成员
  let available = members.filter(m => m.可用 === 1);
  if (available.length < peoplePerDay) {
    throw new Error(`可用人数不足 (需要 ${peoplePerDay} 人，实际 ${available.length} 人)`);
  }

  // ... (rest of function until getting sortedGroup)

  // 平均能力
  const avgAbility = available.reduce((s, m) => s + m.能力, 0) / available.length;

  function groupScore(group, strategy = 'default') {
    const names = group.map(m => m.name);
    // 历史查重
    if (history.some(h => h.length === names.length && names.every(n => h.includes(n)))) {
      return null;
    }
    const avg = group.reduce((s, m) => s + m.能力, 0) / group.length;

    // Base Scores
    const fairness = group.reduce((s, m) => s + (10 - m.次数), 0);
    const randomness = Math.random() * 2 - 1;

    let abilityScore = 0;
    if (strategy === 'high_ability') {
      // Higher ability = Higher score
      abilityScore = avg * 2;
    } else if (strategy === 'low_ability') {
      // Lower ability = Higher score (prioritize training?) OR mixed?
      // Let's assume user wants to group low ability people together? Or mixed?
      // Usually "Low Ability" strategy might mean "Prioritize giving duties to low ability to train them"?
      // Or "Group Score" high means this group is GOOD.
      // If strategy is "Low Ability", maybe we want low ability groups?
      // Let's assume:
      // default/balance: ability near average.
      // high_ability: maximize group total ability.
      // low_ability: minimize group total ability.
      abilityScore = (10 - avg) * 2;
    } else if (strategy === 'random') {
      return Math.random() * 100;
    } else {
      // Default: Balance (legacy logic)
      abilityScore = Math.max(0, 10 - Math.abs(avg - avgAbility) * 2);
    }

    // Frequency Strategy
    if (strategy === 'low_freq') {
      return fairness * 5 + randomness; // Heavily weight fairness (low frequency)
    }

    return abilityScore + fairness + randomness;
  }

  const result = [];

  for (let d = 0; d < days; d++) {
    let combos = [];
    const allGroups = getCombinations(available, peoplePerDay);

    allGroups.forEach(group => {
      const score = groupScore(group, strategy);
      if (score !== null) combos.push({ group, score });
    });

    if (combos.length === 0) {
      history = [];
      writeJSON(historyPath, history);
      allGroups.forEach(group => {
        const score = groupScore(group, strategy);
        if (score !== null) combos.push({ group, score });
      });
      if (combos.length === 0) throw new Error("无法生成有效分组");
    }

    combos.sort((a, b) => b.score - a.score);
    const topN = Math.max(1, Math.floor(combos.length / 10));
    const chosen = combos[Math.floor(Math.random() * topN)];
    if (!chosen) throw new Error("无法生成有效分组");

    const sortedGroup = chosen.group.sort((a, b) => b.能力 - a.能力);
    const names = sortedGroup.map(m => m.name);

    // Assign Roles
    // If roles provided, map them index by index. Excess members get no role string.
    const groupWithRoles = sortedGroup.map((m, idx) => ({
      name: m.name,
      role: roles[idx] || (idx === 0 ? "组长" : "") // Default to "组长" if no roles provided
    }));

    // For raw output compatibility, we might want simple strings, but new requirements ask for Roles.
    // To support frontend that expects simple strings in `group` array, we might break if we change `group` structure completely.
    // However, new requirements imply we want richer data.
    // Let's store objects in `group` for the result.
    // Frontend needs to handle this. Since we are updating frontend too, this is fine.

    // BUT WAIT: history relies on names array for deduplication. Let's keep history as names.
    // Update local history/members for next iteration (even in dryRun)
    history.push(names);

    result.push({
      date: new Date(new Date(startDate).getTime() + d * 86400000).toISOString().split("T")[0],
      group: groupWithRoles // Now array of {name, role}
    });

    members.forEach(m => {
      if (names.includes(m.name)) m.次数 += 1;
    });
  }

  if (!dryRun) {
    writeJSON(memberPath, members);
    writeJSON(historyPath, history);
  }

  return result;
}

// ====================
// 监督更新：能力 + 次数 调整
// ====================
function applySuperviseUpdate(name, cleanScore, filePaths) {
  const { memberPath, supervisePath } = filePaths;
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
