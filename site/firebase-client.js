(function (global) {
  "use strict";
  let app, auth, db;

  function requireUser() {
    if (!auth || !auth.currentUser) throw new Error("Firebase 登入尚未完成，請重新整理頁面。");
    return auth.currentUser;
  }
  function stamp() { return Date.now(); }
  function attemptRef(id) { return db.collection("attempts").doc(id); }
  function boardRef(sessionId, board, studentId) {
    return db.collection("sessions").doc(sessionId).collection("boards").doc(board).collection("entries").doc(studentId);
  }
  function validateText(value, label, max) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new Error(label + "格式不正確。");
    return value.trim();
  }
  function validateGroup(v) {
    if (v !== "zh" && v !== "en") throw new Error("經濟科組別不正確。");
  }
  function validateClass(value) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, "").toUpperCase() : "";
    if (["4A", "4B", "4C", "4D"].indexOf(normalized) < 0) throw new Error("班別不正確。請輸入 4A、4B、4C 或 4D。");
    return normalized;
  }
  function canStartStage(stage, results) {
    if (stage === "stage1") return true;
    if (stage === "stage2A") return !!results.stage1;
    if (stage === "stage2B") return !!results.stage1 && !!results.stage2A;
    if (stage === "stage3") return !!results.stage1 && !!results.stage2A && !!results.stage2B;
    return false;
  }
  function streakBonus(combo) {
    if (combo >= 15) return 3;
    if (combo >= 10) return 2;
    if (combo >= 5) return 1;
    return 0;
  }
  function bestWins(candidate, old) {
    if (!old) return true;
    if (candidate.score !== old.score) return candidate.score > old.score;
    if (candidate.durationMs !== old.durationMs) return candidate.durationMs < old.durationMs;
    return candidate.completedAtMs < (old.completedAtMs || Number.MAX_SAFE_INTEGER);
  }
  async function writeBestInTransaction(tx, ref, candidate) {
    const oldSnap = await tx.get(ref);
    const old = oldSnap.exists ? oldSnap.data() : null;
    if (bestWins(candidate, old)) tx.set(ref, candidate);
  }
  function boardCandidate(attempt, score, durationMs, completedAtMs) {
    return {
      ownerUid: attempt.ownerUid,
      studentId: attempt.studentId,
      nickname: attempt.nickname,
      className: attempt.className,
      group: attempt.group,
      score: score,
      durationMs: durationMs,
      overtimeMs: Math.max(0, durationMs - 15 * 60 * 1000),
      completedAtMs: completedAtMs,
      sessionId: attempt.sessionId
    };
  }
  function validateQuestionOrder(order, questions) {
    const ids = questions.map(function (q) { return q.id; }).sort();
    if (!Array.isArray(order) || order.length !== ids.length) throw new Error("題目次序資料不正確。");
    const sorted = order.slice().sort();
    if (sorted.some(function (id, i) { return id !== ids[i]; })) throw new Error("題目次序包含重複或無效項目。");
  }
  function validateAnswerKeys(answers, questions) {
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new Error("答案資料不正確。");
    const ids = questions.map(function (q) { return q.id; }).sort();
    const keys = Object.keys(answers).sort();
    if (keys.length !== ids.length || keys.some(function (id, i) { return id !== ids[i]; })) throw new Error("答案不完整。");
  }

  async function init(config) {
    if (!config || !config.apiKey || !config.projectId) throw new Error("Firebase 設定不完整，請檢查 firebase-config.js。");
    if (!global.firebase.apps.length) global.firebase.initializeApp(config);
    app = global.firebase.app();
    auth = app.auth();
    db = app.firestore();
    if (!auth.currentUser) await auth.signInAnonymously();
    return auth.currentUser;
  }

  async function getPublicState() {
    requireUser();
    const active = await db.collection("settings").doc("activeSession").get();
    if (!active.exists || !active.data().sessionId) return { sessionId: null, sessionTitle: null };
    const sessionId = active.data().sessionId;
    const session = await db.collection("sessions").doc(sessionId).get();
    return { sessionId: sessionId, sessionTitle: session.exists ? session.data().title : "市場結構大挑戰" };
  }

  async function getRoster(payload) {
    requireUser();
    const className = validateClass(payload.className);
    const snap = await db.collection("students").get();
    const students = snap.docs.map(function (doc) {
      const student = doc.data();
      return { id: doc.id, name: student.realName, className: student.className, active: student.active };
    }).filter(function (student) {
      return String(student.className || "").replace(/\s+/g, "").toUpperCase() === className && student.active === true;
    }).map(function (student) {
      return { id: student.id, name: student.name };
    }).sort(function (a, b) { return a.name.localeCompare(b.name, "zh-Hant"); });
    return { students: students };
  }

  async function registerStudent(payload) {
    const user = requireUser();
    const studentId = validateText(payload.studentId, "學生", 100);
    const nickname = validateText(payload.nickname, "遊戲花名", 20);
    if (/[<>]/.test(nickname)) throw new Error("遊戲花名不能包含 < 或 >。");
    const ref = db.collection("students").doc(studentId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().active !== true) throw new Error("名單中找不到這位學生，請重新選擇。");
    const student = snap.data();
    if (student.authUid && student.authUid !== user.uid) throw new Error("此姓名已在另一個瀏覽器登記。如有需要，請老師協助處理。");
    await ref.update({ authUid: user.uid, nickname: nickname, nicknameUpdatedAt: stamp() });
    return { studentId: studentId, name: student.realName, className: student.className, group: student.group, nickname: nickname };
  }

  async function startAttempt(payload) {
    const user = requireUser();
    const studentId = validateText(payload.studentId, "學生", 100);
    const studentRef = db.collection("students").doc(studentId);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) throw new Error("找不到學生名單。");
    const student = studentSnap.data();
    if (student.active !== true || student.authUid !== user.uid) throw new Error("學生身份未確認，請重新登記。");
    const activeSnap = await db.collection("settings").doc("activeSession").get();
    if (!activeSnap.exists || !activeSnap.data().sessionId) throw new Error("老師尚未開放挑戰場次。");
    const sessionId = activeSnap.data().sessionId;
    const now = stamp();
    const ref = db.collection("attempts").doc();
    await ref.set({
      ownerUid: user.uid, studentId: studentId, realName: student.realName,
      nickname: student.nickname || "Economics Player", group: student.group,
      className: student.className, sessionId: sessionId, status: "in_progress",
      startedAtMs: now, stageStarts: {}, stageResults: {}, combo: 0, maxCombo: 0,
      createdAtMs: now, updatedAtMs: now
    });
    return { attemptId: ref.id, sessionId: sessionId, startedAtMs: now };
  }

  async function startStage(payload) {
    const user = requireUser();
    const stage = validateText(payload.stage, "關卡", 20);
    if (["stage1", "stage2A", "stage2B", "stage3"].indexOf(stage) < 0) throw new Error("未知關卡。");
    const ref = attemptRef(validateText(payload.attemptId, "挑戰", 100));
    return db.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("找不到挑戰紀錄。");
      const attempt = snap.data();
      if (attempt.ownerUid !== user.uid || attempt.status !== "in_progress") throw new Error("這個挑戰目前不能繼續。");
      const results = attempt.stageResults || {};
      if (!canStartStage(stage, results)) throw new Error("請先完成上一個遊戲部分。");
      if (results[stage]) throw new Error("此部分已經提交。");
      const starts = attempt.stageStarts || {};
      if (starts[stage]) return { startedAtMs: starts[stage] };
      const now = stamp();
      tx.update(ref, { ["stageStarts." + stage]: now, updatedAtMs: now });
      return { startedAtMs: now };
    });
  }

  async function submitStage(payload) {
    const user = requireUser();
    const stage = validateText(payload.stage, "關卡", 20);
    const ref = attemptRef(validateText(payload.attemptId, "挑戰", 100));
    const game = global.GAME_DATA;
    if (!game) throw new Error("遊戲題目尚未載入。");
    const now = stamp();

    return db.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("找不到挑戰紀錄。");
      const attempt = snap.data();
      if (attempt.ownerUid !== user.uid || attempt.status !== "in_progress") throw new Error("這個挑戰目前不能提交。");
      const prior = attempt.stageResults || {};
      if (prior[stage]) throw new Error("此部分已經提交，不能重複計分。");
      if (!canStartStage(stage, prior)) throw new Error("請先完成上一個遊戲部分。");
      const started = attempt.stageStarts && attempt.stageStarts[stage];
      if (!started) throw new Error("此部分的計時尚未開始。");

      let score = 0, correctCount = 0, combo = attempt.combo || 0, maxCombo = attempt.maxCombo || 0;
      let answerData = null, placementData = null;
      if (stage === "stage1") {
        if (!Array.isArray(payload.answers) || payload.answers.length !== game.stage1.length) throw new Error("第一關答案不完整。");
        answerData = payload.answers.slice();
        game.stage1.forEach(function (q, i) {
          const selected = q.options.find(function (o) { return o.id === answerData[i]; });
          const correct = !!(selected && selected.optimal);
          if (correct) { score += 10; correctCount++; combo++; maxCombo = Math.max(maxCombo, combo); }
          else combo = 0;
        });
      } else if (stage === "stage2A") {
        const cards = game.stage2Cards;
        if (!payload.placements || typeof payload.placements !== "object" || Object.keys(payload.placements).length !== cards.length) throw new Error("分類卡答案不完整。");
        placementData = payload.placements;
        cards.forEach(function (card) {
          if (placementData[card.id] === card.target) { score += 2; correctCount++; }
        });
      } else if (stage === "stage2B") {
        const qs = game.stage2B;
        validateAnswerKeys(payload.answers, qs);
        validateQuestionOrder(payload.questionOrder, qs);
        answerData = payload.answers;
        payload.questionOrder.forEach(function (id) {
          const q = qs.find(function (item) { return item.id === id; });
          const correct = answerData[id] === q.correct;
          if (correct) { score += 3; correctCount++; combo++; maxCombo = Math.max(maxCombo, combo); }
          else combo = 0;
        });
      } else if (stage === "stage3") {
        const qs = game.stage3;
        validateAnswerKeys(payload.answers, qs);
        validateQuestionOrder(payload.questionOrder, qs);
        answerData = payload.answers;
        payload.questionOrder.forEach(function (id) {
          const q = qs.find(function (item) { return item.id === id; });
          const correct = answerData[id] === q.correct;
          if (correct) { score += 6; correctCount++; combo++; maxCombo = Math.max(maxCombo, combo); }
          else combo = 0;
        });
      } else {
        throw new Error("未知關卡。");
      }

      const durationMs = Math.max(0, now - started);
      const total = stage === "stage1" ? 3 : stage === "stage2A" ? 8 : stage === "stage2B" ? 10 : 4;
      const stageResults = Object.assign({}, prior);
      stageResults[stage] = {
        score: score, correctCount: correctCount, total: total, durationMs: durationMs,
        completedAtMs: now, answers: answerData, placements: placementData
      };
      const updates = { stageResults: stageResults, combo: combo, maxCombo: maxCombo, updatedAtMs: now };
      if (stage === "stage1") updates.stage1Score = score;
      if (stage === "stage2A") updates.stage2AScore = score;
      if (stage === "stage2B") {
        updates.stage2BScore = score;
        updates.stage2DurationMs = Math.max(0, now - (attempt.stageStarts.stage2A || started));
      }
      if (stage === "stage3") updates.stage3Score = score;

      let targetBoard = null, candidate = null;
      if (stage === "stage1") {
        targetBoard = boardRef(attempt.sessionId, "stage1", attempt.studentId);
        candidate = boardCandidate(attempt, score, durationMs, now);
      } else if (stage === "stage2B") {
        targetBoard = boardRef(attempt.sessionId, "stage2", attempt.studentId);
        candidate = boardCandidate(attempt, (attempt.stage2AScore || 0) + score, Math.max(0, now - (attempt.stageStarts.stage2A || started)), now);
      } else if (stage === "stage3") {
        targetBoard = boardRef(attempt.sessionId, "stage3", attempt.studentId);
        candidate = boardCandidate(attempt, score, durationMs, now);
      }

      if (targetBoard) await writeBestInTransaction(tx, targetBoard, candidate);
      tx.update(ref, updates);
      return { score: score, correctCount: correctCount, total: total, durationMs: durationMs, combo: combo, maxCombo: maxCombo };
    });
  }

  async function completeAttempt(payload) {
    const user = requireUser();
    const ref = attemptRef(validateText(payload.attemptId, "挑戰", 100));
    return db.runTransaction(async function (tx) {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("找不到挑戰紀錄。");
      const attempt = snap.data();
      if (attempt.ownerUid !== user.uid) throw new Error("你沒有權限提交這個挑戰。");
      if (attempt.status === "completed") return attempt.finalResult;
      if (attempt.status !== "in_progress") throw new Error("挑戰目前不能提交。");
      const results = attempt.stageResults || {};
      if (!results.stage1 || !results.stage2A || !results.stage2B || !results.stage3) throw new Error("請完成所有遊戲部分。");
      const stageScores = {
        stage1: results.stage1.score, stage2A: results.stage2A.score,
        stage2B: results.stage2B.score, stage3: results.stage3.score,
        stage2: results.stage2A.score + results.stage2B.score
      };
      const baseScore = stageScores.stage1 + stageScores.stage2A + stageScores.stage2B + stageScores.stage3;
      const bonus = streakBonus(attempt.maxCombo || 0);
      const now = stamp();
      const durationMs = Number.isFinite(payload.activeDurationMs) ? Math.max(0, payload.activeDurationMs) : Math.max(0, now - attempt.startedAtMs);
      const timeLimitMs = Number.isFinite(payload.timeLimitMs) ? Math.max(0, payload.timeLimitMs) : 15 * 60 * 1000;
      const overtimeMs = Math.max(0, durationMs - timeLimitMs);
      const stageDurations = {
        stage1: results.stage1.durationMs, stage2A: results.stage2A.durationMs,
        stage2B: results.stage2B.durationMs,
        stage2: attempt.stage2DurationMs || (results.stage2A.durationMs + results.stage2B.durationMs),
        stage3: results.stage3.durationMs
      };
      const finalResult = {
        totalScore: baseScore + bonus, baseScore: baseScore, streakBonus: bonus,
        maxCombo: attempt.maxCombo || 0, durationMs: durationMs,
        timeLimitMs: timeLimitMs, overtimeMs: overtimeMs, timedOut: overtimeMs > 0,
        pausedDurationMs: Number.isFinite(payload.pausedDurationMs) ? Math.max(0, payload.pausedDurationMs) : 0,
        completedAtMs: now, stageScores: stageScores, stageDurations: stageDurations
      };
      const totalRef = boardRef(attempt.sessionId, "total", attempt.studentId);
      await writeBestInTransaction(tx, totalRef, boardCandidate(attempt, finalResult.totalScore, durationMs, now));
      tx.update(ref, {
        status: "completed", completedAtMs: now, totalScore: finalResult.totalScore,
        baseScore: baseScore, streakBonus: bonus, totalDurationMs: durationMs,
        timeLimitMs: timeLimitMs, overtimeMs: overtimeMs, timedOut: overtimeMs > 0,
        pausedDurationMs: finalResult.pausedDurationMs,
        finalResult: finalResult, updatedAtMs: now
      });
      return finalResult;
    });
  }

  async function getLeaderboard(payload) {
    requireUser();
    const board = validateText(payload.board, "排行榜", 20);
    if (["total", "stage1", "stage2", "stage3"].indexOf(board) < 0) throw new Error("排行榜類別不正確。");
    const active = await db.collection("settings").doc("activeSession").get();
    if (!active.exists || !active.data().sessionId) return { entries: [] };
    const snap = await db.collection("sessions").doc(active.data().sessionId)
      .collection("boards").doc(board).collection("entries").get();
    const rows = snap.docs.map(function (doc) { return doc.data(); });
    rows.sort(function (a, b) {
      return b.score - a.score || a.durationMs - b.durationMs || a.completedAtMs - b.completedAtMs;
    });
    return { entries: rows.slice(0, 50).map(function (row, i) {
      return {
        rank: i + 1, nickname: row.nickname, className: row.className,
        group: row.group, score: row.score, durationMs: row.durationMs,
        overtimeMs: row.overtimeMs || 0, completedAtMs: row.completedAtMs
      };
    }) };
  }

  async function studentIdFor(row) {
    const raw = row.group + "|" + row.className + "|" + row.realName;
    const bytes = new TextEncoder().encode(raw);
    const digest = await global.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("").slice(0, 28);
  }

  async function adminAddStudent(payload) {
    requireUser();
    const className = validateClass(payload.className);
    const realName = validateText(payload.realName, "學生姓名", 80);
    const group = "zh";
    const id = await studentIdFor({ group: group, className: className, realName: realName });
    await db.collection("students").doc(id).set({
      group: group, className: className, realName: realName,
      active: true, importedAtMs: stamp()
    }, { merge: true });
    return { added: true, className: className, realName: realName };
  }

  async function adminImportRoster(payload) {
    requireUser();
    const rows = payload.students;
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error("每次請匯入 1 至 100 位學生。");
    const batch = db.batch();
    for (const row of rows) {
      validateGroup(row.group);
      const className = validateClass(row.className);
      const realName = validateText(row.realName, "學生姓名", 80);
      const id = await studentIdFor({ group: row.group, className: className, realName: realName });
      batch.set(db.collection("students").doc(id), {
        group: row.group, className: className, realName: realName,
        active: true, importedAtMs: stamp()
      }, { merge: true });
    }
    await batch.commit();
    return { imported: rows.length };
  }

  async function adminCreateSession(payload) {
    requireUser();
    const title = validateText(payload.title, "場次名稱", 80);
    const sessionRef = db.collection("sessions").doc();
    const now = stamp();
    const batch = db.batch();
    batch.set(sessionRef, { title: title, createdAtMs: now, createdBy: auth.currentUser.uid, status: "active" });
    batch.set(db.collection("settings").doc("activeSession"), { sessionId: sessionRef.id, title: title, updatedAtMs: now });
    await batch.commit();
    return { sessionId: sessionRef.id, title: title };
  }

  async function adminGetDashboard() {
    requireUser();
    const result = await Promise.all([
      db.collection("students").get(),
      db.collection("attempts").orderBy("startedAtMs", "desc").limit(500).get(),
      db.collection("sessions").orderBy("createdAtMs", "desc").limit(30).get(),
      db.collection("settings").doc("activeSession").get()
    ]);
    return {
      activeSessionId: result[3].exists ? result[3].data().sessionId : null,
      students: result[0].docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }),
      attempts: result[1].docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }),
      sessions: result[2].docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); })
    };
  }

  const methods = {
    getPublicState: getPublicState, getRoster: getRoster, registerStudent: registerStudent,
    startAttempt: startAttempt, startStage: startStage, submitStage: submitStage,
    completeAttempt: completeAttempt, getLeaderboard: getLeaderboard,
    adminAddStudent: adminAddStudent, adminImportRoster: adminImportRoster, adminCreateSession: adminCreateSession,
    adminGetDashboard: adminGetDashboard
  };
  global.MSQ = {
    init: init,
    auth: function () { return auth; },
    db: function () { return db; },
    call: function (name, payload) {
      if (!methods[name]) return Promise.reject(new Error("未知操作：" + name));
      try { return Promise.resolve(methods[name](payload || {})); }
      catch (error) { return Promise.reject(error); }
    }
  };
})(window);
