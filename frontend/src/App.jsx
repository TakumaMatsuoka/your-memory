import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const emptyMemory = {
  trackId: "1",
  title: "",
  photoUrl: "",
  content: "",
  people: "",
  labelsText: "",
  memoryDate: "",
};

function normalizeDateInput(value) {
  if (!value) return "";
  const text = String(value).replace(/\//g, "-");
  const m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return "";
  return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
}

function App() {
  const [page, setPage] = useState("home");
  const [mode, setMode] = useState("login");
  const [auth, setAuth] = useState({ email: "", password: "" });
  const [registerPhase, setRegisterPhase] = useState("request");
  const [registerCode, setRegisterCode] = useState("");
  const [token, setToken] = useState(localStorage.getItem("your_memory_token") || "");
  const [userName, setUserName] = useState(localStorage.getItem("your_memory_username") || "");
  const [userEmail, setUserEmail] = useState(localStorage.getItem("your_memory_email") || "");
  const [userBirthDate, setUserBirthDate] = useState(
    normalizeDateInput(localStorage.getItem("your_memory_birth_date") || "")
  );
  const [memories, setMemories] = useState([]);
  const [timelineView, setTimelineView] = useState("month");
  const [birthNodeMode, setBirthNodeMode] = useState("all");
  const [showBirthNodePanel, setShowBirthNodePanel] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [memoryForm, setMemoryForm] = useState(emptyMemory);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showMemoryForm, setShowMemoryForm] = useState(false);
  const [accountForm, setAccountForm] = useState({ username: "", birthDate: "" });
  const [accountDeletePassword, setAccountDeletePassword] = useState("");
  const [accountEmailForm, setAccountEmailForm] = useState({ email: "", password: "" });
  const [lineVisible, setLineVisible] = useState(false);
  const [titleVisible, setTitleVisible] = useState(false);
  const [showPeriodPanel, setShowPeriodPanel] = useState(false);
  const [showTrackPanel, setShowTrackPanel] = useState(false);
  const [showTrackEditId, setShowTrackEditId] = useState(null);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState(null);
  const [editForm, setEditForm] = useState(emptyMemory);
  const [tracks, setTracks] = useState([
    { id: 1, title: "あなた", lineColor: "#2d3748", nodeColor: "#2f64d8", birthDate: "" },
    { id: 2, title: "LINE 2", lineColor: "#2d3748", nodeColor: "#2f64d8", birthDate: "" },
    { id: 3, title: "LINE 3", lineColor: "#2d3748", nodeColor: "#2f64d8", birthDate: "" },
  ]);
  const [hoveredPopupId, setHoveredPopupId] = useState("");
  const [pinnedPopupIds, setPinnedPopupIds] = useState([]);
  const [activeDateLine, setActiveDateLine] = useState("");
  const homeScrollRefs = useRef({});
  const authScrollRefs = useRef({});
  const scrollSyncLock = useRef(false);

  const demoNodes = useMemo(() => {
    const out = [];
    const now = new Date();
    const total = 120;
    for (let i = 0; i < total; i += 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - (total - 1 - i), 1);
      const month = String(d.getMonth() + 1).padStart(2, "0");
      out.push({
        id: `d${i + 1}`,
        left: total === 1 ? 50 : 4 + (i / (total - 1)) * 92,
        title: `サンプル思い出 ${i + 1}`,
        dateTime: `${d.getFullYear()}/${month}/01 12:00`,
        detail: "ログイン後はこの位置にあなたの思い出が表示されます。",
        labels: ["#サンプル"],
      });
    }
    return out;
  }, []);

  const parsedSearch = useMemo(() => {
    const parts = searchText.trim().split(/\s+/).filter(Boolean);
    const labelsInQuery = [];
    const words = [];
    for (const part of parts) {
      if (part.startsWith("#") && part.length > 1) {
        labelsInQuery.push(part.slice(1));
      } else {
        words.push(part);
      }
    }
    return { query: words.join(" "), label: labelsInQuery[0] || "" };
  }, [searchText]);

  const filteredMemories = useMemo(() => {
    return memories.filter((memory) => inRange(memory.memoryDate, rangeFrom, rangeTo));
  }, [memories, rangeFrom, rangeTo]);

  const filteredDemoNodes = useMemo(() => {
    return demoNodes.filter((node) => inRange(node.dateTime.slice(0, 10).replace(/\//g, "-"), rangeFrom, rangeTo));
  }, [demoNodes, rangeFrom, rangeTo]);

  const homeTrackWidth = useMemo(() => getTrackWidthPx(filteredDemoNodes.length), [filteredDemoNodes.length]);
  const memoryTrackWidth = useMemo(() => getTrackWidthPx(filteredMemories.length), [filteredMemories.length]);
  const globalTimelineStartDate = useMemo(() => {
    const timestamps = tracks
      .map((track) => track.birthDate || (track.id === 1 ? userBirthDate : ""))
      .filter(Boolean)
      .map((v) => toTs(v))
      .filter(Number.isFinite);
    if (timestamps.length === 0) return "";
    const oldest = new Date(Math.min(...timestamps));
    return `${oldest.getFullYear()}-${String(oldest.getMonth() + 1).padStart(2, "0")}-${String(oldest.getDate()).padStart(2, "0")}`;
  }, [tracks, userBirthDate]);
  const tracksStorageKey = useMemo(() => {
    const key = userEmail || "guest";
    return `your_memory_tracks_${key}`;
  }, [userEmail]);

  const request = useCallback(async (path, options = {}) => {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${API_URL}${path}`, { ...options, headers });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "エラーが発生しました。");
    }
    return data;
  }, [token]);

  const loadMemories = useCallback(async () => {
    try {
      const data = await request(
        `/memories?view=${timelineView}&q=${encodeURIComponent(parsedSearch.query)}&label=${encodeURIComponent(parsedSearch.label)}`
      );
      setMemories(data.memories);
      if (data.user?.birthDate) {
        const normalizedBirthDate = normalizeDateInput(data.user.birthDate);
        setUserBirthDate(normalizedBirthDate);
        localStorage.setItem("your_memory_birth_date", normalizedBirthDate);
        setTracks((prev) =>
          prev.map((t) => (t.id === 1 ? { ...t, birthDate: t.birthDate || normalizedBirthDate } : t))
        );
      }
      if (data.user?.username) {
        setUserName(data.user.username);
        localStorage.setItem("your_memory_username", data.user.username);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [timelineView, parsedSearch, request]);

  useEffect(() => {
    if (token) {
      loadMemories();
    }
  }, [token, loadMemories]);

  useEffect(() => {
    if (!token) return;
    try {
      const raw = localStorage.getItem(tracksStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setTracks(parsed.map((t) => ({
          id: Number(t.id),
          title: t.title || `LINE ${t.id}`,
          lineColor: t.lineColor || "#2d3748",
          nodeColor: t.nodeColor || "#2f64d8",
          birthDate: normalizeDateInput(t.birthDate || ""),
        })));
      }
    } catch (_e) {
      // noop
    }
  }, [token, tracksStorageKey]);

  useEffect(() => {
    if (!token) return;
    localStorage.setItem(tracksStorageKey, JSON.stringify(tracks));
  }, [tracks, token, tracksStorageKey]);

  useEffect(() => {
    setLineVisible(false);
    const timer = setTimeout(() => setLineVisible(true), 2200);
    return () => clearTimeout(timer);
  }, [token]);

  useEffect(() => {
    setTitleVisible(false);
    const timer = setTimeout(() => setTitleVisible(true), 700);
    return () => clearTimeout(timer);
  }, [token, page]);

  useEffect(() => {
    function handleOutsideClick(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        showMemoryForm &&
        !target.closest(".memory-register-menu") &&
        !target.closest(".memory-register-button")
      ) {
        setShowMemoryForm(false);
      }
      if (showPeriodPanel && !target.closest(".period-panel") && !target.closest(".period-toggle-button")) {
        setShowPeriodPanel(false);
      }
      if (showTrackPanel && !target.closest(".track-panel") && !target.closest(".track-panel-button")) {
        setShowTrackPanel(false);
      }
      if (showBirthNodePanel && !target.closest(".birth-node-panel") && !target.closest(".birth-node-toggle-button")) {
        setShowBirthNodePanel(false);
      }
      if (showTrackEditId !== null && !target.closest(".track-inline-panel") && !target.closest(".track-edit-button")) {
        setShowTrackEditId(null);
      }
      if (editingMemoryId && !target.closest(".memory-edit-card") && !target.closest(".event-actions button")) {
        setEditingMemoryId(null);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showMemoryForm, showTrackEditId, editingMemoryId, showPeriodPanel, showTrackPanel, showBirthNodePanel]);

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      let data;
      if (mode === "register") {
        if (registerPhase === "request") {
          const requestData = await request("/auth/register/request-code", {
            method: "POST",
            body: JSON.stringify(auth),
          });
          if (requestData.debugCode) {
            setMessage(`認証コード送信（開発表示）: ${requestData.debugCode}`);
          } else {
            setMessage("認証コードをメールに送信しました。");
          }
          setRegisterPhase("verify");
          return;
        }
        data = await request("/auth/register/verify-code", {
          method: "POST",
          body: JSON.stringify({ email: auth.email, code: registerCode }),
        });
      } else {
        data = await request("/auth/login", {
          method: "POST",
          body: JSON.stringify(auth),
        });
      }
      setToken(data.token);
      setUserName(data.user.username || "");
      setUserEmail(data.user.email);
      const normalizedBirthDate = normalizeDateInput(data.user.birthDate || "");
      setUserBirthDate(normalizedBirthDate);
      setAccountForm({ username: data.user.username || "", birthDate: normalizedBirthDate });
      setAccountEmailForm((prev) => ({ ...prev, email: data.user.email || "" }));
      setTracks((prev) =>
        prev.map((t) => (t.id === 1 ? { ...t, birthDate: t.birthDate || normalizedBirthDate || "" } : t))
      );
      localStorage.setItem("your_memory_token", data.token);
      localStorage.setItem("your_memory_username", data.user.username || "");
      localStorage.setItem("your_memory_email", data.user.email);
      localStorage.setItem("your_memory_birth_date", normalizedBirthDate || "");
      setMessage("ログインしました。");
      setPage("home");
      setRegisterCode("");
      setRegisterPhase("request");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleMemorySubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const payload = {
        trackId: Number(memoryForm.trackId || 1),
        title: memoryForm.title,
        photoUrl: memoryForm.photoUrl,
        content: memoryForm.content,
        people: memoryForm.people,
        labels: memoryForm.labelsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        memoryDate: memoryForm.memoryDate,
      };
      await request("/memories", { method: "POST", body: JSON.stringify(payload) });
      setMemoryForm(emptyMemory);
      setShowMemoryForm(false);
      setMessage("思い出を登録しました。");
      await loadMemories();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editingMemoryId) return;
    setError("");
    setMessage("");
    try {
      const payload = {
        trackId: Number(editForm.trackId || 1),
        title: editForm.title,
        photoUrl: editForm.photoUrl,
        content: editForm.content,
        people: editForm.people,
        labels: editForm.labelsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        memoryDate: editForm.memoryDate,
      };
      await request(`/memories/${editingMemoryId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setEditingMemoryId(null);
      setEditForm(emptyMemory);
      setMessage("思い出を更新しました。");
      await loadMemories();
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadAccount() {
    try {
      const data = await request("/account");
      const normalizedBirthDate = normalizeDateInput(data.user.birthDate || "");
      setAccountForm({ username: data.user.username || "", birthDate: normalizedBirthDate });
      setAccountEmailForm((prev) => ({ ...prev, email: data.user.email || "" }));
      setUserName(data.user.username || "");
      setUserEmail(data.user.email || "");
      setUserBirthDate(normalizedBirthDate);
      localStorage.setItem("your_memory_username", data.user.username || "");
      localStorage.setItem("your_memory_birth_date", normalizedBirthDate);
      setTracks((prev) => prev.map((t) => (t.id === 1 ? { ...t, birthDate: normalizedBirthDate || t.birthDate } : t)));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAccountUpdate(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      await request("/account", { method: "PUT", body: JSON.stringify(accountForm) });
      setUserName(accountForm.username);
      setUserBirthDate(accountForm.birthDate);
      setTracks((prev) => prev.map((t) => (t.id === 1 ? { ...t, birthDate: accountForm.birthDate } : t)));
      localStorage.setItem("your_memory_username", accountForm.username);
      localStorage.setItem("your_memory_birth_date", accountForm.birthDate);
      setMessage("マイアカウントを更新しました。");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAccountEmailUpdate(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const data = await request("/account/email", {
        method: "PUT",
        body: JSON.stringify(accountEmailForm),
      });
      setUserEmail(data.email);
      localStorage.setItem("your_memory_email", data.email);
      setAccountEmailForm((prev) => ({ ...prev, password: "" }));
      setMessage("メールアドレスを更新しました。");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAccountDelete(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      await request("/account", { method: "DELETE", body: JSON.stringify({ password: accountDeletePassword }) });
      logout();
      setPage("home");
    } catch (e) {
      setError(e.message);
    }
  }

  function logout() {
    setToken("");
    setUserName("");
    setUserEmail("");
    setUserBirthDate("");
    setMemories([]);
    setAccountEmailForm({ email: "", password: "" });
    localStorage.removeItem("your_memory_token");
    localStorage.removeItem("your_memory_username");
    localStorage.removeItem("your_memory_email");
    localStorage.removeItem("your_memory_birth_date");
  }

  function openAuthPage(targetMode) {
    setMode(targetMode);
    setPage("auth");
  }

  function startEdit(memory) {
    setEditingMemoryId(memory.id);
    setEditForm({
      title: memory.title || "",
      trackId: String(memory.trackId || 1),
      photoUrl: memory.photoUrl || "",
      content: memory.content || "",
      people: memory.people || "",
      labelsText: memory.labels?.join(", ") || "",
      memoryDate: memory.memoryDate || "",
    });
  }

  function getAxisTicks(view, globalStartDateText, birthDateText) {
    const now = new Date();
    let dates = [];
    if (globalStartDateText) {
      const start = new Date(`${globalStartDateText}T00:00:00`);
      if (Number.isNaN(start.getTime()) || start > now) {
        dates = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear() - (5 - i), 0, 1));
      } else {
        const startTs = start.getTime();
        const nowTs = now.getTime();
        dates = Array.from({ length: 6 }, (_, i) => {
          const ratio = i / 5;
          const ts = startTs + (nowTs - startTs) * ratio;
          const d = new Date(ts);
          d.setHours(0, 0, 0, 0);
          return d;
        });
      }
    } else if (view === "year") {
      dates = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear() - (5 - i), 0, 1));
    } else if (view === "week") {
      dates = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - (5 - i) * 7);
        return d;
      });
    } else {
      dates = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (5 - i), 1));
    }

    return dates.map((d, idx) => {
      let dateLabel = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (view === "year") {
        dateLabel = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
      }
      if (view === "week") dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const dateText = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const age = birthDateText ? calculateAgeForDisplay(birthDateText, dateText) : null;
      let ageLabel = "";
      if (birthDateText) {
        const birthTs = toTs(birthDateText);
        const tickTs = toTs(dateText);
        if (Number.isFinite(birthTs) && Number.isFinite(tickTs) && tickTs >= birthTs) {
          ageLabel = age === 0 ? "0歳" : `${age}歳`;
        }
      } else if (idx === 0) {
        ageLabel = "0歳";
      }
      if (idx === dates.length - 1) ageLabel = "現在";
      return { ageLabel, dateLabel };
    });
  }

  function calculateAgeForDisplay(birthDateText, eventDateText) {
    const birth = new Date(`${birthDateText}T00:00:00`);
    const event = new Date(`${eventDateText}T00:00:00`);
    let age = event.getFullYear() - birth.getFullYear();
    const m = event.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && event.getDate() < birth.getDate())) {
      age -= 1;
    }
    return Math.max(age, 0);
  }

  function toTs(dateText) {
    return new Date(`${dateText}T00:00:00`).getTime();
  }

  function getTrackWidthPx(nodeCount) {
    if (nodeCount <= 10) {
      return "100%";
    }
    return `${Math.max(1100, nodeCount * 80)}px`;
  }

  function addTrack() {
    setTracks((prev) => {
      if (prev.length >= 10) return prev;
      const nextId = prev.length === 0 ? 1 : Math.max(...prev.map((t) => t.id)) + 1;
      return [
        ...prev,
        { id: nextId, title: `ライン ${prev.length + 1}`, lineColor: "#2d3748", nodeColor: "#2f64d8", birthDate: "" },
      ];
    });
  }

  function removeTrack(id) {
    setTracks((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((t) => t.id !== id);
    });
  }

  function updateTrackTitle(id, title) {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  }

  function updateTrackColor(id, key, value) {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, [key]: value } : t)));
  }

  function updateTrackBirthDate(id, value) {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, birthDate: value } : t)));
  }
  function getMemoryLeftPercent(memoryDate, globalStartDateText, fallbackIndex, totalCount) {
    const ts = toTs(memoryDate);
    if (!Number.isFinite(ts)) return 50;
    const startTs = globalStartDateText ? toTs(globalStartDateText) : NaN;
    const min = Number.isFinite(startTs) ? startTs : ts;
    const max = Date.now();
    if (max <= min) {
      return totalCount > 0 ? ((fallbackIndex + 1) / (totalCount + 1)) * 100 : 50;
    }
    const ratio = (ts - min) / (max - min);
    return 4 + Math.max(0, Math.min(1, ratio)) * 92;
  }

  function getLineStartPercent(trackBirthDateText) {
    const startTs = globalTimelineStartDate ? toTs(globalTimelineStartDate) : NaN;
    const trackTs = trackBirthDateText ? toTs(trackBirthDateText) : NaN;
    const maxTs = Date.now();
    if (!Number.isFinite(startTs) || !Number.isFinite(trackTs) || maxTs <= startTs || trackTs <= startTs) {
      return 4;
    }
    return 4 + Math.max(0, Math.min(1, (trackTs - startTs) / (maxTs - startTs))) * 92;
  }

  function getTrackNodeLeftPercent(memoryDate, trackBirthDateText, fallbackIndex, totalCount) {
    const lineStart = getLineStartPercent(trackBirthDateText);
    const nodeLeft = getMemoryLeftPercent(memoryDate, globalTimelineStartDate, fallbackIndex, totalCount);
    return Math.max(nodeLeft, lineStart);
  }

  function buildBirthTimelineNodes(trackBirthDateText, mode) {
    if (!trackBirthDateText || mode === "off") return [];
    const birth = new Date(`${trackBirthDateText}T00:00:00`);
    const now = new Date();
    if (!Number.isFinite(birth.getTime()) || birth > now) return [];
    const nodes = [
      { id: `birth-${trackBirthDateText}`, dateText: trackBirthDateText, age: 0, title: "生年月日" },
    ];
    let age = 1;
    while (true) {
      const d = new Date(birth);
      d.setFullYear(birth.getFullYear() + age);
      if (d > now) break;
      const dateText = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const shouldInclude =
        mode === "all" ||
        (mode === "5" && age % 5 === 0) ||
        (mode === "10" && age % 10 === 0);
      if (shouldInclude) {
        nodes.push({ id: `birthday-${dateText}`, dateText, age, title: `${age}歳の誕生日` });
      }
      age += 1;
    }
    return nodes;
  }


  function inRange(dateText, from, to) {
    if (!dateText) return false;
    const d = new Date(`${dateText}T00:00:00`).getTime();
    if (!Number.isFinite(d)) return false;
    if (from) {
      const f = new Date(`${from}T00:00:00`).getTime();
      if (d < f) return false;
    }
    if (to) {
      const t = new Date(`${to}T23:59:59`).getTime();
      if (d > t) return false;
    }
    return true;
  }

  function handleTimelineScroll(sourceEl) {
    if (!sourceEl || scrollSyncLock.current) return;
    scrollSyncLock.current = true;
    const left = sourceEl.scrollLeft;
    const allEls = [
      ...Object.values(homeScrollRefs.current),
      ...Object.values(authScrollRefs.current),
    ].filter(Boolean);
    allEls.forEach((el) => {
      if (el !== sourceEl) {
        el.scrollLeft = left;
      }
    });
    requestAnimationFrame(() => {
      scrollSyncLock.current = false;
    });
  }

  if (!token) {
    if (page === "auth") {
      return (
        <main className="container auth-page">
          <header className={`brand-center ${titleVisible ? "show-title" : ""}`}>
            <button className="brand-link glass-text title-reveal" onClick={() => setPage("home")}>
              Your Memory
            </button>
            <p className="lead glass-subtitle subtitle-reveal">時間軸に、あなたの思い出を点として残すサービス。</p>
          </header>
          <h2 className="auth-title">{mode === "login" ? "ログイン" : "新規登録"}</h2>
          <form onSubmit={handleAuthSubmit} className="card form auth-card">
            <label>
              メールアドレス
              <input
                type="email"
                required
                value={auth.email}
                onChange={(e) => setAuth((prev) => ({ ...prev, email: e.target.value }))}
              />
            </label>
            <label>
              パスワード（8文字以上）
              <input
                type="password"
                required
                minLength={8}
                value={auth.password}
                onChange={(e) => setAuth((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            {mode === "register" && registerPhase === "verify" && (
              <label>
                認証コード（6桁）
                <input
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  required
                  value={registerCode}
                  onChange={(e) => setRegisterCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                />
              </label>
            )}
            <div className="auth-actions">
              <button type="submit">
                {mode === "login" ? "ログイン" : registerPhase === "request" ? "認証コード送信" : "認証して登録"}
              </button>
              <button type="button" onClick={() => setPage("home")}>
                ホームへ戻る
              </button>
            </div>
            <p className="auth-switch">
              {mode === "login" ? "アカウントをお持ちでないですか？" : "すでにアカウントをお持ちですか？"}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => {
                  setMode((prev) => (prev === "login" ? "register" : "login"));
                  setRegisterPhase("request");
                  setRegisterCode("");
                }}
              >
                {mode === "login" ? "新規登録へ切替" : "ログインへ切替"}
              </button>
            </p>
          </form>
          {error && <p className="error">{error}</p>}
        </main>
      );
    }

    return (
      <main className="container">
        <header className={`brand-center ${titleVisible ? "show-title" : ""}`}>
          <button className="brand-link glass-text title-reveal" onClick={() => setPage("home")}>
            Your Memory
          </button>
          <p className="lead glass-subtitle subtitle-reveal">時間軸に、あなたの思い出を点として残すサービス。</p>
        </header>
        <div className="top command-bar">
          <div className="search preview" onClick={() => openAuthPage("login")}>
            <input
              readOnly
              value=""
              placeholder="検索（#旅行 のようにラベル検索）"
              onFocus={() => openAuthPage("login")}
            />
          </div>
          <div className="color-menu">
            <button type="button" onClick={() => setShowPeriodPanel((v) => !v)}>
              期間: {timelineView === "year" ? "年次" : timelineView === "month" ? "月次" : "週次"}
            </button>
            {showPeriodPanel && (
              <div className="color-panel period-panel">
                <div className="period-switch-row">
                  <button type="button" onClick={() => setTimelineView("year")}>年次</button>
                  <button type="button" onClick={() => setTimelineView("month")}>月次</button>
                  <button type="button" onClick={() => setTimelineView("week")}>週次</button>
                </div>
                <div className="period-range-row">
                  <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                  <span>〜</span>
                  <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
                </div>
              </div>
            )}
          </div>
          <div className="color-menu">
            <button type="button" onClick={() => setShowTrackPanel((v) => !v)}>
              線を追加
            </button>
            {showTrackPanel && (
              <div className="color-panel track-panel">
                <button type="button" onClick={addTrack} disabled={tracks.length >= 10}>
                  線を追加（最大10）
                </button>
                {tracks.map((track) => (
                  <div key={`home-track-${track.id}`} className="track-row">
                    <input
                      value={track.title}
                      onChange={(e) => updateTrackTitle(track.id, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="tabs">
            <button onClick={() => openAuthPage("login")}>ログイン/新規登録</button>
          </div>
        </div>

        <section className="home-hero">
          <section className="timeline-stack">
            {tracks.map((track) => (
              <section
                key={`home-line-${track.id}`}
                className={`timeline preview ${lineVisible ? "show-line" : ""}`}
                style={{ "--line-color": track.lineColor, "--node-color": track.nodeColor }}
                onClick={() => openAuthPage("login")}
              >
              <div className="track-header">
                <p className="track-title">{track.title}</p>
                <button
                  type="button"
                  className="track-edit-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTrackEditId((prev) => (prev === track.id ? null : track.id));
                  }}
                >
                  編集
                </button>
                {showTrackEditId === track.id && (
                  <div className="track-inline-panel" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="track-close-button" onClick={() => setShowTrackEditId(null)}>
                      ×
                    </button>
                    <input value={track.title} onChange={(e) => updateTrackTitle(track.id, e.target.value)} />
                    <label className="color-control">
                      線色
                      <input
                        type="color"
                        value={track.lineColor}
                        onChange={(e) => updateTrackColor(track.id, "lineColor", e.target.value)}
                      />
                    </label>
                    <label className="color-control">
                      ノード色
                      <input
                        type="color"
                        value={track.nodeColor}
                        onChange={(e) => updateTrackColor(track.id, "nodeColor", e.target.value)}
                      />
                    </label>
                    <button type="button" onClick={() => removeTrack(track.id)} disabled={tracks.length <= 1}>
                      線を削除
                    </button>
                  </div>
                )}
              </div>
              <div
                className="timeline-scroll"
                ref={(el) => {
                  homeScrollRefs.current[track.id] = el;
                }}
                onScroll={(e) => handleTimelineScroll(e.currentTarget)}
              >
                <div className="timeline-track" style={{ width: homeTrackWidth }}>
                  <div className="line" />
                  <div className="nodes">
                    {filteredDemoNodes.map((node, index) => {
                      const popupId = `home-${track.id}-${node.id}`;
                      const showPopup = hoveredPopupId === popupId || pinnedPopupIds.includes(popupId);
                      return (
                        <article
                          className="node demo"
                          key={`${track.id}-${node.id}`}
                          style={{ left: `${node.left}%`, "--node-delay": `${0.2 + index * 0.03}s` }}
                          onMouseEnter={() => setHoveredPopupId(popupId)}
                          onMouseLeave={() => setHoveredPopupId("")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPinnedPopupIds((prev) =>
                              prev.includes(popupId)
                                ? prev.filter((id) => id !== popupId)
                                : [...prev, popupId]
                            );
                          }}
                        >
                          <div className="dot" title="ログイン後に思い出ノードを使えます" />
                          <div className={`event-popover ${showPopup ? "show" : ""}`}>
                            <div className="event-prop"><span>イベント名</span><strong>{node.title}</strong></div>
                            <div className="event-prop"><span>年月日時間</span><strong>{node.dateTime}</strong></div>
                            <div className="event-prop"><span>詳細</span><p>{node.detail}</p></div>
                            <div className="event-prop"><span>ラベル</span><strong>{node.labels.join(" ")}</strong></div>
                          </div>
                          <div className={`node-photo-placeholder ${showPopup ? "show" : ""}`}>サンプル画像</div>
                        </article>
                      );
                    })}
                  </div>
                  <div className="timeline-age-axis">
                    {getAxisTicks(timelineView, "", "").map((tick, index) => (
                      <span key={`home-age-${track.id}-${index}`}>{tick.ageLabel}</span>
                    ))}
                  </div>
                  <div className="timeline-date-axis">
                    {getAxisTicks(timelineView, "", "").map((tick, index) => (
                      <span key={`home-date-${track.id}-${index}`}>{tick.dateLabel}</span>
                    ))}
                  </div>
                </div>
              </div>
              </section>
            ))}
          </section>
        </section>
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  if (page === "account") {
    return (
      <main className="container">
        <header className={`brand-center ${titleVisible ? "show-title" : ""}`}>
          <button className="brand-link glass-text title-reveal" onClick={() => setPage("home")}>
            Your Memory
          </button>
          <p className="lead glass-subtitle subtitle-reveal">マイアカウント</p>
        </header>
        <section className="card">
          <h2>アカウント設定</h2>
          <form onSubmit={handleAccountUpdate} className="form">
            <label>
              ログイン名
              <input
                required
                minLength={2}
                maxLength={32}
                value={accountForm.username}
                onChange={(e) => setAccountForm((prev) => ({ ...prev, username: e.target.value }))}
              />
            </label>
            <label>
              生年月日
              <input
                type="date"
                required
                value={accountForm.birthDate}
                onChange={(e) => setAccountForm((prev) => ({ ...prev, birthDate: e.target.value }))}
              />
            </label>
            <div className="edit-actions">
              <button type="submit">保存</button>
              <button type="button" onClick={() => setPage("home")}>ホームへ戻る</button>
            </div>
          </form>
        </section>
        <section className="card">
          <h2>メールアドレス変更</h2>
          <form onSubmit={handleAccountEmailUpdate} className="form">
            <label>
              新しいメールアドレス
              <input
                type="email"
                required
                value={accountEmailForm.email}
                onChange={(e) => setAccountEmailForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </label>
            <label>
              パスワード確認
              <input
                type="password"
                required
                minLength={8}
                value={accountEmailForm.password}
                onChange={(e) => setAccountEmailForm((prev) => ({ ...prev, password: e.target.value }))}
              />
            </label>
            <button type="submit">メールアドレスを更新</button>
          </form>
        </section>
        <section className="card">
          <h2>アカウント削除</h2>
          <form onSubmit={handleAccountDelete} className="form">
            <label>
              パスワード
              <input
                type="password"
                required
                minLength={8}
                value={accountDeletePassword}
                onChange={(e) => setAccountDeletePassword(e.target.value)}
              />
            </label>
            <button type="submit">アカウントを削除</button>
          </form>
        </section>
        {message && <p className="message">{message}</p>}
        {error && <p className="error">{error}</p>}
      </main>
    );
  }

  return (
    <main className="container">
      <header className={`brand-center ${titleVisible ? "show-title" : ""}`}>
        <button className="brand-link glass-text title-reveal" onClick={() => setPage("home")}>
          Your Memory
        </button>
        <p className="lead glass-subtitle subtitle-reveal">時間軸に、あなたの思い出を点として残すサービス。</p>
      </header>

      <header className="top command-bar">
        <div className="search">
          <input
            placeholder="検索（例: 夏祭り #家族）"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <div className="user">
          <span>{userName || userEmail.split("@")[0] || "ユーザー"}</span>
          <button onClick={async () => { await loadAccount(); setPage("account"); }}>マイアカウント</button>
          <button onClick={logout}>ログアウト</button>
        </div>
        <div className="color-menu">
          <button className="period-toggle-button" type="button" onClick={() => setShowPeriodPanel((v) => !v)}>
            期間: {timelineView === "year" ? "年次" : timelineView === "month" ? "月次" : "週次"}
          </button>
          {showPeriodPanel && (
            <div className="color-panel period-panel">
              <div className="period-switch-row">
                <button type="button" onClick={() => setTimelineView("year")}>年次</button>
                <button type="button" onClick={() => setTimelineView("month")}>月次</button>
                <button type="button" onClick={() => setTimelineView("week")}>週次</button>
              </div>
              <div className="period-range-row">
                <input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
                <span>〜</span>
                <input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <div className="color-menu">
          <button className="track-panel-button" type="button" onClick={() => setShowTrackPanel((v) => !v)}>
            線を追加
          </button>
          {showTrackPanel && (
            <div className="color-panel track-panel">
              <button type="button" onClick={addTrack} disabled={tracks.length >= 10}>
                線を追加（最大10）
              </button>
              {tracks.map((track) => (
                <div key={`auth-track-${track.id}`} className="track-row">
                  <input
                    value={track.title}
                    onChange={(e) => updateTrackTitle(track.id, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="color-menu">
          <button className="memory-register-button" type="button" onClick={() => setShowMemoryForm((v) => !v)}>
            思い出の登録
          </button>
          {showMemoryForm && (
            <div className="color-panel track-panel memory-register-menu">
              <form onSubmit={handleMemorySubmit} className="form">
                <label>
                  追加先ライン
                  <select
                    value={memoryForm.trackId}
                    onChange={(e) => setMemoryForm((prev) => ({ ...prev, trackId: e.target.value }))}
                  >
                    {tracks.map((track) => (
                      <option key={`memory-track-${track.id}`} value={String(track.id)}>
                        {track.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  タイトル
                  <input
                    required
                    value={memoryForm.title}
                    onChange={(e) => setMemoryForm((prev) => ({ ...prev, title: e.target.value }))}
                  />
                </label>
                <label>
                  写真URL（任意）
                  <input
                    type="text"
                    value={memoryForm.photoUrl}
                    onChange={(e) => setMemoryForm((prev) => ({ ...prev, photoUrl: e.target.value }))}
                  />
                </label>
                <label>
                  日付
                  <input
                    type="date"
                    required
                    value={memoryForm.memoryDate}
                    onChange={(e) => setMemoryForm((prev) => ({ ...prev, memoryDate: e.target.value }))}
                  />
                </label>
                <label>
                  人物
                  <input
                    value={memoryForm.people}
                    onChange={(e) => setMemoryForm((prev) => ({ ...prev, people: e.target.value }))}
                  />
                </label>
                <label>
                  ラベル（カンマ区切り）
                  <input
                    value={memoryForm.labelsText}
                    onChange={(e) => setMemoryForm((prev) => ({ ...prev, labelsText: e.target.value }))}
                  />
                </label>
                <label>
                  内容
                  <textarea
                    required
                    rows={3}
                    value={memoryForm.content}
                    onChange={(e) => setMemoryForm((prev) => ({ ...prev, content: e.target.value }))}
                  />
                </label>
                <button type="submit">登録する</button>
              </form>
            </div>
          )}
        </div>
      </header>

      <section className="card controls">
        <div className="switches">
          <button className={timelineView === "year" ? "active" : ""} onClick={() => setTimelineView("year")}>
            年次
          </button>
          <button className={timelineView === "month" ? "active" : ""} onClick={() => setTimelineView("month")}>
            月次
          </button>
          <button className={timelineView === "week" ? "active" : ""} onClick={() => setTimelineView("week")}>
            週次
          </button>
          <div className="color-menu">
            <button
              className={`birth-node-toggle-button ${birthNodeMode !== "off" ? "active" : ""}`}
              onClick={() => setShowBirthNodePanel((v) => !v)}
            >
              生年月日ノード: {birthNodeMode === "off" ? "非表示" : birthNodeMode === "all" ? "毎年" : `${birthNodeMode}歳ごと`}
            </button>
            {showBirthNodePanel && (
              <div className="color-panel birth-node-panel">
                <button type="button" onClick={() => setBirthNodeMode("off")}>非表示</button>
                <button type="button" onClick={() => setBirthNodeMode("all")}>毎年</button>
                <button type="button" onClick={() => setBirthNodeMode("5")}>5歳ごと</button>
                <button type="button" onClick={() => setBirthNodeMode("10")}>10歳ごと</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="card timeline-stack-card">
        <div className="timeline-stack">
          {tracks.map((track) => (
            (() => {
              const trackBirthDate = track.birthDate || (track.id === 1 ? userBirthDate : "");
              const lineStartPercent = getLineStartPercent(trackBirthDate);
              const trackMemories = filteredMemories.filter((memory) => Number(memory.trackId || 1) === track.id);
              const birthTimelineNodes = buildBirthTimelineNodes(trackBirthDate, birthNodeMode);
              const dateSet = new Set();
              if (birthNodeMode !== "off" && trackBirthDate) {
                dateSet.add(trackBirthDate);
              }
              trackMemories.forEach((memory) => dateSet.add(memory.memoryDate));
              const uniqueTrackDates = Array.from(dateSet);
              return (
            <section
              key={`auth-line-${track.id}`}
              className={`timeline ${lineVisible ? "show-line" : ""}`}
              style={{
                "--line-color": track.lineColor,
                "--node-color": track.nodeColor,
                "--line-start": `${lineStartPercent}%`,
              }}
            >
          <div className="track-header">
            <p className="track-title">{track.title}</p>
            <button
              type="button"
              className="track-edit-button"
              onClick={() => setShowTrackEditId((prev) => (prev === track.id ? null : track.id))}
            >
              編集
            </button>
            {showTrackEditId === track.id && (
              <div className="track-inline-panel">
                <button type="button" className="track-close-button" onClick={() => setShowTrackEditId(null)}>
                  ×
                </button>
                <input value={track.title} onChange={(e) => updateTrackTitle(track.id, e.target.value)} />
                <label className="color-control">
                  線色
                  <input
                    type="color"
                    value={track.lineColor}
                    onChange={(e) => updateTrackColor(track.id, "lineColor", e.target.value)}
                  />
                </label>
                <label className="color-control">
                  ノード色
                  <input
                    type="color"
                    value={track.nodeColor}
                    onChange={(e) => updateTrackColor(track.id, "nodeColor", e.target.value)}
                  />
                </label>
                <label className="color-control">
                  生年月日
                  <input
                    type="date"
                    value={track.birthDate || ""}
                    onChange={(e) => updateTrackBirthDate(track.id, e.target.value)}
                  />
                </label>
                <button type="button" onClick={() => removeTrack(track.id)} disabled={tracks.length <= 1}>
                  線を削除
                </button>
              </div>
            )}
          </div>
          <div
            className="timeline-scroll"
            ref={(el) => {
              authScrollRefs.current[track.id] = el;
            }}
            onScroll={(e) => handleTimelineScroll(e.currentTarget)}
          >
            <div className="timeline-track" style={{ width: memoryTrackWidth }}>
              {activeDateLine && (
                <div
                  className="date-crosshair"
                  style={{
                    left: `${getTrackNodeLeftPercent(activeDateLine, trackBirthDate, 0, trackMemories.length)}%`,
                  }}
                />
              )}
              <div className="line" />
              {trackMemories.length === 0 && <p className="empty">条件に合う思い出はありません。</p>}
              <div className="nodes">
                {birthTimelineNodes.map((birthNode, birthIndex) => {
                  const birthPopupId = `birth-${track.id}-${birthNode.id}`;
                  const showBirthPopup = hoveredPopupId === birthPopupId || pinnedPopupIds.includes(birthPopupId);
                  return (
                    <article
                      className="node birth-node"
                      key={`birth-${track.id}-${birthNode.id}`}
                      style={{
                        left: `${getTrackNodeLeftPercent(
                          birthNode.dateText,
                          trackBirthDate,
                          birthIndex,
                          birthTimelineNodes.length
                        )}%`,
                        "--node-delay": `${0.12 + birthIndex * 0.03}s`,
                      }}
                      onMouseEnter={() => setHoveredPopupId(birthPopupId)}
                      onMouseLeave={() => setHoveredPopupId("")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDateLine(birthNode.dateText);
                        setPinnedPopupIds((prev) =>
                          prev.includes(birthPopupId)
                            ? prev.filter((id) => id !== birthPopupId)
                            : [...prev, birthPopupId]
                        );
                      }}
                    >
                      <div className="dot" title={birthNode.title} />
                      <div className={`event-popover ${showBirthPopup ? "show" : ""}`}>
                        <div className="event-prop"><span>イベント名</span><strong>{birthNode.title}</strong></div>
                        <div className="event-prop"><span>年月日時間</span><strong>{birthNode.dateText} 00:00</strong></div>
                        <div className="event-prop"><span>詳細</span><p>このノードは固定です。</p></div>
                        <div className="event-prop"><span>ラベル</span><strong>#生年月日</strong></div>
                        <div className="event-prop"><span>年齢</span><strong>{birthNode.age}歳</strong></div>
                      </div>
                    </article>
                  );
                })}
                {trackMemories.map((memory, index) => {
                  const popupId = `auth-${track.id}-${memory.id}`;
                  const showPopup = hoveredPopupId === popupId || pinnedPopupIds.includes(popupId);
                  return (
                    <article
                      className="node"
                      key={`${track.id}-${memory.id}`}
                      style={{
                        left: `${getTrackNodeLeftPercent(
                          memory.memoryDate,
                          trackBirthDate,
                          index,
                          trackMemories.length
                        )}%`,
                        "--node-delay": `${0.25 + index * 0.12}s`,
                      }}
                      onMouseEnter={() => setHoveredPopupId(popupId)}
                      onMouseLeave={() => setHoveredPopupId("")}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDateLine(memory.memoryDate);
                        setPinnedPopupIds((prev) =>
                          prev.includes(popupId)
                            ? prev.filter((id) => id !== popupId)
                            : [...prev, popupId]
                        );
                      }}
                    >
                      <div className="dot" title={memory.title} />
                      <div className={`event-popover ${showPopup ? "show" : ""}`}>
                        <div className="event-prop"><span>イベント名</span><strong>{memory.title}</strong></div>
                        <div className="event-prop"><span>年月日時間</span><strong>{memory.memoryDate} 00:00</strong></div>
                        <div className="event-prop"><span>詳細</span><p>{memory.content}</p></div>
                        <div className="event-prop">
                          <span>ラベル</span>
                          <strong>
                            {(memory.labels?.length ? memory.labels.map((l) => `#${l}`).join(" ") : "#なし")}
                          </strong>
                        </div>
                        {memory.ageAtMemory !== null && (
                          <div className="event-prop">
                            <span>年齢</span>
                            <strong>{memory.ageAtMemory}歳</strong>
                          </div>
                        )}
                        <div className="event-actions">
                          <button type="button" onClick={() => startEdit(memory)}>編集</button>
                        </div>
                      </div>
                      {memory.photoUrl ? (
                        <a className={`node-photo-wrap ${showPopup ? "show" : ""}`} href={memory.photoUrl} target="_blank" rel="noreferrer">
                          <img className="node-photo" src={memory.photoUrl} alt={memory.title} />
                        </a>
                      ) : (
                        <div className={`node-photo-placeholder ${showPopup ? "show" : ""}`}>画像なし</div>
                      )}
                    </article>
                  );
                })}
              </div>
              <div className="timeline-age-axis">
                {getAxisTicks(
                  timelineView,
                  globalTimelineStartDate,
                  track.birthDate || (track.id === 1 ? userBirthDate : "")
                ).map((tick, index) => (
                  <span key={`age-${track.id}-${index}`}>{tick.ageLabel}</span>
                ))}
              </div>
              <div className="timeline-date-axis">
                {uniqueTrackDates.map((dateText) => (
                  <span
                    key={`date-${track.id}-${dateText}`}
                    style={{
                      position: "absolute",
                      left: `${getTrackNodeLeftPercent(dateText, trackBirthDate, 0, trackMemories.length)}%`,
                      transform: "translateX(-50%)",
                    }}
                  >
                    {dateText.replace(/-/g, "/")}
                  </span>
                ))}
              </div>
            </div>
          </div>
            </section>
              );
            })()
          ))}
        </div>
      </section>

      {editingMemoryId && (
        <section className="card memory-edit-card">
          <h2>思い出を編集</h2>
          <form onSubmit={handleEditSubmit} className="form grid">
            <label>
              タイトル
              <input
                required
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
              />
            </label>
            <label>
              ライン
              <select
                value={editForm.trackId}
                onChange={(e) => setEditForm((prev) => ({ ...prev, trackId: e.target.value }))}
              >
                {tracks.map((track) => (
                  <option key={`edit-track-${track.id}`} value={String(track.id)}>
                    {track.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              写真URL（任意）
              <input
                type="text"
                value={editForm.photoUrl}
                onChange={(e) => setEditForm((prev) => ({ ...prev, photoUrl: e.target.value }))}
              />
            </label>
            <label>
              日付（カレンダー）
              <input
                type="date"
                required
                value={editForm.memoryDate}
                onChange={(e) => setEditForm((prev) => ({ ...prev, memoryDate: e.target.value }))}
              />
            </label>
            <label>
              人物
              <input
                value={editForm.people}
                onChange={(e) => setEditForm((prev) => ({ ...prev, people: e.target.value }))}
              />
            </label>
            <label className="full">
              ラベル（カンマ区切り）
              <input
                value={editForm.labelsText}
                onChange={(e) => setEditForm((prev) => ({ ...prev, labelsText: e.target.value }))}
              />
            </label>
            <label className="full">
              内容
              <textarea
                required
                rows={4}
                value={editForm.content}
                onChange={(e) => setEditForm((prev) => ({ ...prev, content: e.target.value }))}
              />
            </label>
            <div className="edit-actions full">
              <button type="submit">更新する</button>
              <button type="button" onClick={() => setEditingMemoryId(null)}>
                キャンセル
              </button>
            </div>
          </form>
        </section>
      )}

      {message && <p className="message">{message}</p>}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

export default App;
