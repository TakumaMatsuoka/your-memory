import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const emptyMemory = {
  title: "",
  photoUrl: "",
  content: "",
  people: "",
  labelsText: "",
  memoryDate: "",
};

function App() {
  const [page, setPage] = useState("home");
  const [mode, setMode] = useState("login");
  const [auth, setAuth] = useState({ email: "", password: "", birthDate: "" });
  const [token, setToken] = useState(localStorage.getItem("your_memory_token") || "");
  const [userEmail, setUserEmail] = useState(localStorage.getItem("your_memory_email") || "");
  const [userBirthDate, setUserBirthDate] = useState(
    localStorage.getItem("your_memory_birth_date") || ""
  );
  const [memories, setMemories] = useState([]);
  const [timelineView, setTimelineView] = useState("month");
  const [searchText, setSearchText] = useState("");
  const [memoryForm, setMemoryForm] = useState(emptyMemory);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
    { id: 1, title: "あなた", lineColor: "#2d3748", nodeColor: "#2f64d8" },
    { id: 2, title: "LINE 2", lineColor: "#2d3748", nodeColor: "#2f64d8" },
    { id: 3, title: "LINE 3", lineColor: "#2d3748", nodeColor: "#2f64d8" },
  ]);
  const [hoveredPopupId, setHoveredPopupId] = useState("");
  const [pinnedPopupIds, setPinnedPopupIds] = useState([]);
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

  const memoryLeftById = useMemo(() => {
    if (memories.length === 0) {
      return {};
    }
    const timestamps = memories.map((m) => toTs(m.memoryDate)).filter((v) => Number.isFinite(v));
    if (timestamps.length === 0) {
      return {};
    }
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    const span = Math.max(max - min, 1);
    const result = {};
    for (const memory of memories) {
      const ts = toTs(memory.memoryDate);
      if (!Number.isFinite(ts)) {
        result[memory.id] = 50;
      } else if (max === min) {
        result[memory.id] = 50;
      } else {
        result[memory.id] = 4 + ((ts - min) / span) * 92;
      }
    }
    return result;
  }, [memories]);

  const filteredMemories = useMemo(() => {
    return memories.filter((memory) => inRange(memory.memoryDate, rangeFrom, rangeTo));
  }, [memories, rangeFrom, rangeTo]);

  const filteredDemoNodes = useMemo(() => {
    return demoNodes.filter((node) => inRange(node.dateTime.slice(0, 10).replace(/\//g, "-"), rangeFrom, rangeTo));
  }, [demoNodes, rangeFrom, rangeTo]);

  const homeTrackWidth = useMemo(() => getTrackWidthPx(filteredDemoNodes.length), [filteredDemoNodes.length]);
  const memoryTrackWidth = useMemo(() => getTrackWidthPx(filteredMemories.length), [filteredMemories.length]);

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
        setUserBirthDate(data.user.birthDate);
        localStorage.setItem("your_memory_birth_date", data.user.birthDate);
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
    setLineVisible(false);
    const timer = setTimeout(() => setLineVisible(true), 2200);
    return () => clearTimeout(timer);
  }, [token]);

  useEffect(() => {
    setTitleVisible(false);
    const timer = setTimeout(() => setTitleVisible(true), 700);
    return () => clearTimeout(timer);
  }, [token, page]);

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const endpoint = mode === "login" ? "/auth/login" : "/auth/register";
      const data = await request(endpoint, {
        method: "POST",
        body: JSON.stringify(auth),
      });
      setToken(data.token);
      setUserEmail(data.user.email);
      setUserBirthDate(data.user.birthDate || "");
      localStorage.setItem("your_memory_token", data.token);
      localStorage.setItem("your_memory_email", data.user.email);
      localStorage.setItem("your_memory_birth_date", data.user.birthDate || "");
      setMessage("ログインしました。");
      setPage("home");
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

  function logout() {
    setToken("");
    setUserEmail("");
    setUserBirthDate("");
    setMemories([]);
    localStorage.removeItem("your_memory_token");
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
      photoUrl: memory.photoUrl || "",
      content: memory.content || "",
      people: memory.people || "",
      labelsText: memory.labels?.join(", ") || "",
      memoryDate: memory.memoryDate || "",
    });
  }

  function getAxisTicks(view, birthDateText) {
    const now = new Date();
    let dates = [];
    if (view === "year") {
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
      if (view === "year") dateLabel = `${d.getFullYear()}年`;
      if (view === "week") dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const dateText = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const age = birthDateText ? calculateAgeForDisplay(birthDateText, dateText) : null;
      let ageLabel = age === null ? "" : `${age}歳`;
      if (!birthDateText && idx === 0) ageLabel = "0歳";
      if (!birthDateText && idx === dates.length - 1) ageLabel = "現在";
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
      return [...prev, { id: nextId, title: `ライン ${prev.length + 1}`, lineColor: "#2d3748", nodeColor: "#2f64d8" }];
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
            {mode === "register" && (
              <label>
                生年月日
                <input
                  type="date"
                  required
                  value={auth.birthDate}
                  onChange={(e) => setAuth((prev) => ({ ...prev, birthDate: e.target.value }))}
                />
              </label>
            )}
            <div className="auth-actions">
              <button type="submit">{mode === "login" ? "ログイン" : "アカウント作成"}</button>
              <button type="button" onClick={() => setPage("home")}>
                ホームへ戻る
              </button>
            </div>
            <p className="auth-switch">
              {mode === "login" ? "アカウントをお持ちでないですか？" : "すでにアカウントをお持ちですか？"}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => setMode((prev) => (prev === "login" ? "register" : "login"))}
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
                    {getAxisTicks(timelineView, "").map((tick, index) => (
                      <span key={`home-age-${track.id}-${index}`}>{tick.ageLabel}</span>
                    ))}
                  </div>
                  <div className="timeline-date-axis">
                    {getAxisTicks(timelineView, "").map((tick, index) => (
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
          <span>{userEmail}</span>
          <button onClick={logout}>ログアウト</button>
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
        </div>
      </section>

      <section className="card timeline-stack-card">
        <div className="timeline-stack">
          {tracks.map((track) => (
            <section
              key={`auth-line-${track.id}`}
              className={`timeline ${lineVisible ? "show-line" : ""}`}
              style={{ "--line-color": track.lineColor, "--node-color": track.nodeColor }}
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
              <div className="line" />
              {filteredMemories.length === 0 && <p className="empty">条件に合う思い出はありません。</p>}
              <div className="nodes">
                {filteredMemories.map((memory, index) => {
                  const popupId = `auth-${track.id}-${memory.id}`;
                  const showPopup = hoveredPopupId === popupId || pinnedPopupIds.includes(popupId);
                  return (
                    <article
                      className="node"
                      key={`${track.id}-${memory.id}`}
                      style={{
                        left: `${memoryLeftById[memory.id] ?? ((index + 1) / (filteredMemories.length + 1)) * 100}%`,
                        "--node-delay": `${0.25 + index * 0.12}s`,
                      }}
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
                {getAxisTicks(timelineView, userBirthDate).map((tick, index) => (
                  <span key={`age-${track.id}-${index}`}>{tick.ageLabel}</span>
                ))}
              </div>
              <div className="timeline-date-axis">
                {getAxisTicks(timelineView, userBirthDate).map((tick, index) => (
                  <span key={`date-${track.id}-${index}`}>{tick.dateLabel}</span>
                ))}
              </div>
            </div>
          </div>
            </section>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>思い出を登録</h2>
        <p className="calendar-note">カレンダーから日付を選択して登録します。</p>
        <form onSubmit={handleMemorySubmit} className="form grid">
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
              type="url"
              value={memoryForm.photoUrl}
              onChange={(e) => setMemoryForm((prev) => ({ ...prev, photoUrl: e.target.value }))}
            />
          </label>
          <label>
            日付（カレンダー）
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
          <label className="full">
            ラベル（カンマ区切り）
            <input
              placeholder="旅行, 家族, 学生時代"
              value={memoryForm.labelsText}
              onChange={(e) => setMemoryForm((prev) => ({ ...prev, labelsText: e.target.value }))}
            />
          </label>
          <label className="full">
            内容
            <textarea
              required
              rows={4}
              value={memoryForm.content}
              onChange={(e) => setMemoryForm((prev) => ({ ...prev, content: e.target.value }))}
            />
          </label>
          <button type="submit">登録する</button>
        </form>
      </section>

      {editingMemoryId && (
        <section className="card">
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
              写真URL（任意）
              <input
                type="url"
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
