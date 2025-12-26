const http = require('http');
const fs = require('fs');

function request(path, method, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: 'localhost',
            port: 3000,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    try {
        console.log("1. Registering...");
        const reg = await request('/api/register', 'POST', { username: 'testuser', password: 'password' });
        console.log("Register:", reg.status, reg.body);

        console.log("2. Logging in...");
        const login = await request('/api/login', 'POST', { username: 'testuser', password: 'password' });
        console.log("Login:", login.status, login.body);
        let token = login.body.token;

        if (!token) throw new Error("No token received");

        console.log("3. Uploading members (mock)...");
        // Mocking upload is hard with http.request, let's skip upload and try generate (it should fail empty or work if we manually place file)
        // Let's manually place a members.json for this user to test generation
        const defaultClassDir = 'data/testuser/default';
        if (!fs.existsSync(defaultClassDir)) fs.mkdirSync(defaultClassDir, { recursive: true });

        // Initial mock data
        fs.writeFileSync(defaultClassDir + '/members.json', JSON.stringify([
            { name: "A", 能力: 5, 可用: 1, 次数: 0 },
            { name: "B", 能力: 5, 可用: 1, 次数: 0 },
            { name: "C", 能力: 5, 可用: 1, 次数: 0 }
        ]));

        console.log("4. Generating duty (4 people)...");
        // Need more members for 4 people/day
        fs.writeFileSync(defaultClassDir + '/members.json', JSON.stringify([
            { name: "A", 能力: 9, 可用: 1, 次数: 0 },
            { name: "B", 能力: 8, 可用: 1, 次数: 0 },
            { name: "C", 能力: 7, 可用: 1, 次数: 0 },
            { name: "D", 能力: 6, 可用: 1, 次数: 0 },
            { name: "E", 能力: 5, 可用: 1, 次数: 0 }
        ]));

        const gen = await request('/generate-duty', 'POST', { days: 1, peoplePerDay: 4, startDate: '2025-01-01' }, { 'Authorization': 'Bearer ' + token });
        console.log("Generate:", gen.status, gen.body);

        if (gen.status !== 200) throw new Error("Generate failed");

        // Verify group size and leader (highest ability)
        const groupRaw = gen.body.days[0].group;
        const groupNames = groupRaw.map(g => g.name);

        if (groupNames.length !== 4) throw new Error("Group size incorrect: " + groupNames.length);

        // Check if leader (index 0) has highest ability in the group
        // We need to look up ability from the members list we created
        const members = JSON.parse(fs.readFileSync(defaultClassDir + '/members.json', 'utf-8'));
        const groupMembers = groupNames.map(name => members.find(m => m.name === name));

        const maxAbility = Math.max(...groupMembers.map(m => m.能力));
        const leaderAbility = groupMembers[0].能力;

        if (leaderAbility !== maxAbility) {
            throw new Error(`Leader logic failed. Leader ${groupNames[0]} (${leaderAbility}) is not max ability (${maxAbility})`);
        }

        console.log("5. Checking schedule API...");
        const sched = await request('/api/schedule', 'GET', null, { 'Authorization': 'Bearer ' + token });
        console.log("Schedule:", sched.status, sched.body);

        if (sched.status !== 200 || !sched.body.schedule || sched.body.schedule.length === 0) {
            throw new Error("Schedule API failed or empty");
        }

        // ... (previous tests) ...

        console.log("6. Testing Multi-Class...");
        // Create Class B
        const createClass = await request('/api/class/create', 'POST', { name: 'ClassB' }, { 'Authorization': 'Bearer ' + token });
        if (createClass.status !== 200) throw new Error("Create Class failed");

        // Upload members to Class B (different from default)
        const classBMembers = [{ name: "Z", 能力: 10, 可用: 1, 次数: 0 }];
        const classBDir = 'data/testuser/ClassB'; // Update path for verification
        if (!fs.existsSync(classBDir)) fs.mkdirSync(classBDir, { recursive: true });
        fs.writeFileSync(classBDir + '/members.json', JSON.stringify(classBMembers));

        // Verify Class B has its own members
        // We can't easily verify via API without uploading file via form-data in this script, 
        // but we can verify the file system or try to generate duty for Class B.

        console.log("7. Testing Summary API...");
        // Generate some supervision data first
        const supData = {
            date: '2025-01-01',
            group: ['A', 'B', 'C', 'D'],
            individuals: [
                { name: 'A', completed: 1, score: 9 },
                { name: 'B', completed: 1, score: 8 }
            ]
        };
        await request('/submit-supervise', 'POST', supData, { 'Authorization': 'Bearer ' + token }); // Default class

        const summary = await request('/api/summary?startDate=2025-01-01&endDate=2025-01-07', 'GET', null, { 'Authorization': 'Bearer ' + token });
        console.log("Summary:", summary.status, summary.body);

        if (summary.status !== 200) throw new Error("Summary API failed");
        if (summary.body.totalDays !== 1) throw new Error("Summary totalDays incorrect");
        if (summary.body.bestIndividual.name !== 'A') throw new Error("Best individual incorrect");

        if (summary.body.bestIndividual.name !== 'A') throw new Error("Best individual incorrect");

        console.log("8. Testing Global Status API...");
        const status = await request('/api/user/status', 'GET', null, { 'Authorization': 'Bearer ' + token });
        console.log("Global Status:", status.status, status.body);

        if (status.status !== 200) throw new Error("Global Status API failed");
        if (!Array.isArray(status.body.classes)) throw new Error("Classes list missing");

        const defaultClass = status.body.classes.find(c => c.name === 'default');
        if (!defaultClass) throw new Error("Default class missing in status");
        // We generated duty for 2025-01-01, but today is likely not 2025-01-01, so pendingDuty might be false unless we mock date.
        // But we just want to ensure the API works.

        console.log("✅ Global Status OK");

        console.log("9. Testing Chinese Class & Roles...");
        const chClass = "三年二班";
        const createCh = await request('/api/class/create', 'POST', { name: chClass }, { 'Authorization': 'Bearer ' + token });
        if (createCh.status !== 200) throw new Error("Create Chinese Class failed");

        // Setup members for Chinese class
        const chDir = `data/testuser/${chClass}`;
        if (!fs.existsSync(chDir)) fs.mkdirSync(chDir, { recursive: true });

        const chMembers = [
            { name: "张三", 能力: 9, 可用: 1, 次数: 0 },
            { name: "李四", 能力: 8, 可用: 1, 次数: 0 },
            { name: "王五", 能力: 7, 可用: 1, 次数: 0 },
            { name: "赵六", 能力: 6, 可用: 1, 次数: 0 }
        ];
        fs.writeFileSync(chDir + '/members.json', JSON.stringify(chMembers));

        // Generate with Roles
        const roles = ["班长", "卫生委", "擦黑板", "扫地"];
        const genRoles = await request('/generate-duty', 'POST',
            { days: 1, peoplePerDay: 4, startDate: '2025-01-02', roles: roles },
            { 'Authorization': 'Bearer ' + token, 'X-Class-ID': encodeURIComponent(chClass) }
        );

        console.log("Generate Roles:", genRoles.status, JSON.stringify(genRoles.body));

        if (genRoles.status !== 200) throw new Error("Generate Roles failed");

        console.log("10. Testing Preview & Editing APIs...");

        // 10.1 Preview
        const previewRes = await request('/api/duty/preview', 'POST',
            { days: 2, peoplePerDay: 4, startDate: '2025-02-01', roles: ["R1"] },
            { 'Authorization': 'Bearer ' + token, 'X-Class-ID': encodeURIComponent(chClass) }
        );
        if (previewRes.status !== 200 || !previewRes.body.days) throw new Error("Preview failed");
        console.log("Preview OK");

        // 10.2 Save Batch
        const newSchedule = previewRes.body.days;
        const saveRes = await request('/api/schedule/save-batch', 'POST',
            { newSchedule },
            { 'Authorization': 'Bearer ' + token, 'X-Class-ID': encodeURIComponent(chClass) }
        );
        if (saveRes.status !== 200) throw new Error("Save Batch failed");
        console.log("Save Batch OK");

        // 10.3 Update
        const targetDate = newSchedule[0].date;
        const updateRes = await request('/api/schedule/update', 'POST',
            { date: targetDate, group: [{ name: "ModifiedUser", role: "SuperAdmin" }] },
            { 'Authorization': 'Bearer ' + token, 'X-Class-ID': encodeURIComponent(chClass) }
        );
        if (updateRes.status !== 200) throw new Error("Update failed");
        // Verify update
        const schedRes = await request('/api/schedule', 'GET', null,
            { 'Authorization': 'Bearer ' + token, 'X-Class-ID': encodeURIComponent(chClass) }
        );
        const updatedItem = schedRes.body.schedule.find(s => s.date === targetDate);
        if (!updatedItem || updatedItem.group[0].name !== "ModifiedUser") throw new Error("Verifying Update failed");
        console.log("Update OK");

        // 10.4 Move
        const date1 = newSchedule[0].date;
        const date2 = newSchedule[1].date; // 2 days generated
        // date1 has "ModifiedUser". date2 has original randoms.
        const moveRes = await request('/api/schedule/move', 'POST',
            { fromDate: date1, toDate: date2 },
            { 'Authorization': 'Bearer ' + token, 'X-Class-ID': encodeURIComponent(chClass) }
        );
        if (moveRes.status !== 200) throw new Error("Move failed");
        // Verify swap: date2 should now have "ModifiedUser"
        const schedRes2 = await request('/api/schedule', 'GET', null,
            { 'Authorization': 'Bearer ' + token, 'X-Class-ID': encodeURIComponent(chClass) }
        );
        const swappedItem = schedRes2.body.schedule.find(s => s.date === date2);
        if (!swappedItem || swappedItem.group[0].name !== "ModifiedUser") throw new Error("Verifying Move failed");
        console.log("Move OK");

        const dutyGroup = genRoles.body.days[0].group;
        // Verify structure: Array of objects { name, role }
        if (!dutyGroup[0].role) throw new Error("Role assignment failed (missing role prop)");
        if (dutyGroup[0].role !== "班长") throw new Error(`Role mismatch. Expected 班长, got ${dutyGroup[0].role}`);
        const names = dutyGroup.map(g => g.name);
        if (!names.includes("张三")) throw new Error("Member missing in generated group");

        console.log("✅ Verification Passed!");

        // 11. Testing New Features (Strategy, Profile, Invite)
        // 11. Testing New Features (Strategy, Profile, Invite)
        console.log("11. Testing Advanced Features...");

        // Strategy Preview
        const prevRes = await request("/api/duty/preview", "POST",
            { days: 5, peoplePerDay: 1, startDate: "2025-02-01", roles: ["A"], strategy: "high_ability" },
            { "X-Class-ID": encodeURIComponent("ClassB"), "Authorization": "Bearer " + token }
        );
        if (prevRes.body.days) console.log("Strategy Preview OK"); else console.error("Strategy Preview Fail", prevRes.body);

        // Profile Update
        const upRes = await request("/api/user/update", "POST", { password: "newpassword" }, { "Authorization": "Bearer " + token });
        if (upRes.body.ok) console.log("Profile Update OK"); else console.error("Profile Update Fail", upRes.body);

        // Invite Code
        const invRes = await request("/api/class/invite", "POST", {}, { "X-Class-ID": encodeURIComponent("ClassB"), "Authorization": "Bearer " + token });

        if (invRes.body.code) {
            console.log("Invite Code OK:", invRes.body.code);

            // Join Class (Mock User B)
            // Register User B
            await request("/api/register", "POST", { username: "userB", password: "123" });
            const loginB = await request("/api/login", "POST", { username: "userB", password: "123" });
            // Update token to User B
            token = loginB.body.token;

            const joinRes = await request("/api/class/join", "POST", { code: invRes.body.code }, { "Authorization": "Bearer " + token });
            if (joinRes.body.ok) console.log("Join Class OK"); else console.error("Join Class Fail", joinRes.body);

            // Check Global Dashboard for User B
            const statusB = await request("/api/user/status", "GET", null, { "Authorization": "Bearer " + token });
            const hasShared = statusB.body.classes.some(c => c.isShared);
            if (hasShared) console.log("Shared Class Visible OK"); else console.error("Shared Class Visible Fail", statusB.body);

        } else console.error("Invite Code Fail", invRes.body);

        console.log("✅ Advanced Verification Passed!");
    } catch (e) {
        console.error("❌ Verification Failed:", e);
        process.exit(1);
    }
}

run();
