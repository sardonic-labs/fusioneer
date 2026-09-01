<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  type Job = {
    id: string;
    delivery_id: string | null;
    repo: string;
    event: string;
    issue: number | null;
    issue_title: string | null;
    status: 'queued' | 'running' | 'success' | 'failed' | 'skipped';
    phase: string | null;
    branch: string | null;
    logs: string | null;
    created_at: string;
    started_at: string | null;
    finished_at: string | null;
    exit_code: number | null;
  };

  let jobs: Job[] = $state([]);
  let stats: any = $state(null);
  let schedules: any[] = $state([]);
  let health: any = $state(null);
  let selected: Job | null = $state(null);
  let logs = $state('');
  let filterRepo = $state('');
  let filterStatus = $state('');
  let autoRefresh = $state(true);
  let eventSource: EventSource | null = null;
  let searchFocused = $state(false);

  const api = (p: string) => p;

  async function load() {
    try {
      const [j, q, s, h] = await Promise.all([
        fetch(api('/jobs?limit=50')).then(r => r.json()),
        fetch(api('/queue/stats')).then(r => r.json()).catch(() => null),
        fetch(api('/schedules')).then(r => r.json()).catch(() => ({ schedules: [] })),
        fetch(api('/health')).then(r => r.json()).catch(() => null),
      ]);
      jobs = j.jobs ?? [];
      stats = q;
      schedules = s.schedules ?? [];
      health = h;
    } catch (e) {
      console.warn(e);
    }
  }

  function startPolling() {
    load();
    const id = setInterval(() => { if (autoRefresh) load(); }, 2000);
    return () => clearInterval(id);
  }

  let stopPoll: (() => void) | null = null;
  onMount(() => { stopPoll = startPolling(); });
  onDestroy(() => { stopPoll?.(); eventSource?.close(); });

  $effect(() => {
    if (selected) {
      logs = selected.logs ?? '';
      eventSource?.close();
      try {
        const es = new EventSource(api(`/jobs/${selected.id}/logs`));
        eventSource = es;
        es.onmessage = (e) => {
          try { const d = JSON.parse(e.data); if (d.logs) logs = d.logs; } catch {}
        };
        es.addEventListener('done', () => es.close());
        es.onerror = () => es.close();
      } catch {}
    } else {
      eventSource?.close();
      eventSource = null;
    }
  });

  let filtered = $derived(
    jobs.filter(j => {
      if (filterRepo && !j.repo.toLowerCase().includes(filterRepo.toLowerCase())) return false;
      if (filterStatus && j.status !== filterStatus) return false;
      return true;
    })
  );

  let successCount = $derived(jobs.filter(j=>j.status==='success').length);
  let runningCount = $derived(jobs.filter(j=>j.status==='running').length);
  let queuedCount = $derived(jobs.filter(j=>j.status==='queued').length);
  let failedCount = $derived(jobs.filter(j=>j.status==='failed').length);

  function statusMeta(s: string) {
    if (s === 'success') return { bg: '#10b981', bgLight: '#ecfdf5', text: '#065f46', dot: '#10b981', label: 'success', icon: '✓' };
    if (s === 'failed') return { bg: '#ef4444', bgLight: '#fef2f2', text: '#991b1b', dot: '#ef4444', label: 'failed', icon: '✕' };
    if (s === 'running') return { bg: '#6366f1', bgLight: '#eef2ff', text: '#3730a3', dot: '#6366f1', label: 'running', icon: '●' };
    if (s === 'queued') return { bg: '#f59e0b', bgLight: '#fffbeb', text: '#92400e', dot: '#f59e0b', label: 'queued', icon: '◷' };
    return { bg: '#6b7280', bgLight: '#f9fafb', text: '#4b5563', dot: '#6b7280', label: s, icon: '•' };
  }

  function timeAgo(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return `${Math.floor(diff/1000)}s`;
    if (diff < 3600000) return `${Math.floor(diff/60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
    if (diff < 604800000) return `${Math.floor(diff/86400000)}d`;
    return d.toLocaleDateString();
  }
  function copyLogs() { if (logs) navigator.clipboard.writeText(logs); }
</script>

<div class="app">
  <nav class="nav">
    <div class="nav-left">
      <div class="logo">◈</div>
      <div class="brand">
        <div class="brand-name">fusioneer</div>
        <div class="brand-sub">home agents · Tahoe</div>
      </div>
      <div class="divider"></div>
      <div class="nav-stats">
        <span class="stat"><strong>{jobs.length}</strong> jobs</span>
        <span class="stat live"><span class="dot" style="background:#10b981"></span> {health?.ok ? 'live' : 'offline'}</span>
      </div>
    </div>
    <div class="nav-right">
      <label class="switch">
        <input type="checkbox" bind:checked={autoRefresh} />
        <span>auto</span>
      </label>
      <a class="btn ghost" href="/health" target="_blank">API</a>
    </div>
  </nav>

  <section class="hero">
    <div class="hero-main">
      <h1>Your agents, <span class="accent">running at home.</span></h1>
      <p>One Docker on your VPS · <code>webhook</code> → <code>queue</code> → <code>worktree</code> → <code>opencode run</code> → draft PR</p>
    </div>
    <div class="hero-stats">
      <div class="hcard"><div class="hcard-num">{jobs.length}</div><div class="hcard-label">JOBS</div></div>
      <div class="hcard running"><div class="hcard-num">{runningCount}</div><div class="hcard-label">RUNNING</div></div>
      <div class="hcard success"><div class="hcard-num">{successCount}</div><div class="hcard-label">SUCCESS</div></div>
      <div class="hcard failed"><div class="hcard-num">{failedCount}</div><div class="hcard-label">FAILED</div></div>
    </div>
  </section>

  <section class="grid">
    <div class="card">
      <div class="card-head">
        <h3>queue</h3>
        <span class="badge">{stats?.global?.concurrency ?? 2} max · {stats?.global?.pending ?? 0} pending</span>
      </div>
      {#if stats}
        <div class="queue">
          <div class="bar-row">
            <span class="bar-label">global</span>
            <div class="bar"><div class="fill" style="width: {Math.min(100, (stats.global?.pending ?? 0)*25)}%"></div></div>
            <span class="bar-val">{stats.global?.pending} / {stats.global?.size}</span>
          </div>
          <div class="queue-running">
            {#if stats.runningRepos?.length}
              {#each stats.runningRepos as r}<span class="chip">{r}</span>{/each}
            {:else}<span class="muted">idle — no running jobs</span>{/if}
          </div>
          {#each stats.perRepo ?? [] as r}
            <div class="bar-row small">
              <span class="bar-label mono">{r.repo.split('/')[1]}</span>
              <div class="bar thin"><div class="fill amber" style="width: {r.pending ? 100 : 0}%"></div></div>
              <span class="bar-val">{r.pending}</span>
            </div>
          {/each}
        </div>
      {:else}<div class="muted">loading…</div>{/if}
    </div>

    <div class="card">
      <div class="card-head"><h3>schedules</h3><span class="badge">cron · interval</span></div>
      {#if schedules.length === 0}
        <div class="empty">
          <div class="empty-icon">◷</div>
          <div class="empty-title">no active schedules</div>
          <div class="empty-desc">add <code>.opencode/fusioneer.json</code> <code>schedules:[{`{cron:"0 6 * * *",enabled:true}`}]</code></div>
        </div>
      {:else}
        <div class="sched-list">
          {#each schedules as s}
            <div class="sched"><span class="pill">{s.type ?? 'cron'}</span><span class="mono">{s.repo}</span><span class="mono muted">{s.schedule.cron ?? s.schedule.interval}</span></div>
          {/each}
        </div>
      {/if}
      <div class="card-foot">daily backup 02:00 UTC · WAL · 429 backoff</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>filter</h3><span class="badge">{filtered.length}/{jobs.length}</span></div>
      <div class="search" class:focused={searchFocused}>
        <span class="search-icon">⌕</span>
        <input placeholder="filter repo…" bind:value={filterRepo} onfocus={() => searchFocused=true} onblur={() => searchFocused=false} />
      </div>
      <div class="pills">
        {#each ['', 'queued','running','success','failed','skipped'] as s}
          <button class="pill-btn" class:active={filterStatus===s} onclick={() => filterStatus=s}>{s || 'all'}</button>
        {/each}
      </div>
      <div class="filter-meta"><span>{queuedCount} queued</span><span>{runningCount} running</span><span>{successCount} done</span></div>
    </div>
  </section>

  <section class="layout">
    <div class="panel">
      <div class="panel-head">
        <h2>jobs</h2>
        <button class="btn small" onclick={load}>↻ refresh</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>repo & issue</th><th>status</th><th>phase</th><th>branch</th><th>age</th></tr></thead>
          <tbody>
            {#each filtered as j}
              {@const m = statusMeta(j.status)}
              <tr class:selected={selected?.id === j.id} onclick={() => selected = j}>
                <td>
                  <div class="repo">{j.repo}</div>
                  <div class="issue muted">{j.issue ? `#${j.issue}` : '—'} {j.issue_title ? `· ${j.issue_title.slice(0,32)}` : ''}</div>
                </td>
                <td><span class="status-pill" style="background:{m.bgLight}; color:{m.text}; border:1px solid {m.bg}22"><span class="dot" style="background:{m.dot}"></span> {m.label}</span></td>
                <td><span class="phase">{j.phase ?? '—'}</span></td>
                <td class="mono small" title={j.branch ?? ''}>{j.branch ? j.branch.slice(10, 30) + '…' : '—'}</td>
                <td class="muted small">{timeAgo(j.created_at)}</td>
              </tr>
            {/each}
            {#if filtered.length === 0}
              <tr><td colspan="5"><div class="empty"><div class="empty-icon">∅</div><div class="empty-title">no jobs</div><div class="empty-desc">label <code>fusioneer:auto</code> or comment <code>/fusioneer</code> to queue</div></div></td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel detail">
      {#if selected}
        {@const m = statusMeta(selected.status)}
        <div class="detail-head">
          <div>
            <div class="detail-title">{selected.repo} <span class="muted">#{selected.issue}</span></div>
            <div class="detail-sub muted">{selected.issue_title ?? ''}</div>
          </div>
          <button class="btn icon" onclick={() => selected = null}>✕</button>
        </div>
        <div class="detail-meta">
          <span class="status-pill large" style="background:{m.bgLight}; color:{m.text}; border:1px solid {m.bg}22"><span class="dot" style="background:{m.dot}"></span> {selected.status}</span>
          <span class="chip mono">{selected.event}</span>
          <span class="chip mono">{selected.phase}</span>
          <span class="muted small">· {selected.delivery_id?.slice(0,8) ?? '—'} · exit {selected.exit_code ?? '—'}</span>
        </div>
        <div class="detail-grid">
          <div class="meta-item"><span class="muted">branch</span><div class="mono">{selected.branch ?? '—'}</div></div>
          <div class="meta-item"><span class="muted">time</span><div>{timeAgo(selected.created_at)} → {timeAgo(selected.finished_at) || 'now'}</div></div>
        </div>
        <div class="tabs">
          <a class="btn small" href={`https://github.com/${selected.repo}/issues/${selected.issue ?? ''}`} target="_blank">↗ issue</a>
          <a class="btn small" href={`https://github.com/${selected.repo}/pull/${selected.issue ?? ''}`} target="_blank">↗ PR</a>
          <button class="btn small" onclick={copyLogs}>⎘ copy</button>
          <button class="btn small" onclick={() => { if (selected) fetch(`/jobs/${selected.id}/logs`).then(r=>r.json()).then(d=>logs=d.logs); }}>↻ reload</button>
        </div>
        <div class="logs-wrap">
          <div class="logs-head"><span class="muted">logs · {logs.length} chars</span><span class="live-dot" class:on={selected.status==='running'}></span></div>
          <pre class="logs">{logs || 'no logs yet…'}</pre>
        </div>
      {:else}
        <div class="empty big">
          <div class="empty-icon large">◈</div>
          <div class="empty-title large">select a job</div>
          <div class="muted">live logs via <code>/jobs/:id/logs</code> SSE</div>
          <div class="how">
            <div><b>1</b> label <code>fusioneer:auto</code></div>
            <div><b>2</b> workflow <code>POST /webhook/github</code></div>
            <div><b>3</b> SQLite → <code>p-queue</code> 2·1 → worktree <code>opencode run</code></div>
            <div><b>4</b> draft PR <code>Closes #n</code> · <code>/fusioneer revise:</code> (max 3)</div>
          </div>
        </div>
      {/if}
    </div>
  </section>

  <footer>
    <span>fusioneer · Tahoe · Svelte 5</span>
    <span class="links"><a href="/health" target="_blank">health</a> · <a href="/jobs" target="_blank">jobs</a> · <a href="/queue/stats" target="_blank">queue</a></span>
  </footer>
</div>

<style>
  :global(*){box-sizing:border-box}
  :global(body){
    margin:0;
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', Inter, system-ui, sans-serif;
    background: #f8f8f9;
    color: #1d1d1f;
    -webkit-font-smoothing: antialiased;
  }
  :global(code){font-family: ui-monospace, SFMono-Regular, monospace; font-size:12px; background:#f1f5f9; border:1px solid #e2e8f0; padding:2px 6px; border-radius:6px;}
  .app{max-width:1240px; margin:0 auto; padding:20px 20px 32px;}
  /* nav — solid, high contrast */
  .nav{
    display:flex; justify-content:space-between; align-items:center;
    padding:12px 16px; background:#fff; border:1px solid #e2e8f0; border-radius:14px;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06);
    position:sticky; top:12px; z-index:10;
  }
  .nav-left{display:flex; gap:14px; align-items:center;}
  .logo{width:32px; height:32px; border-radius:9px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color:#fff; display:grid; place-items:center; font-size:16px; font-weight:700;}
  .brand-name{font-weight:700; font-size:15px; letter-spacing:-.02em; line-height:1;}
  .brand-sub{font-size:11px; color:#64748b; margin-top:2px;}
  .divider{width:1px; height:28px; background:#e2e8f0; margin:0 2px;}
  .nav-stats{display:flex; gap:12px; font-size:12px; color:#64748b;}
  .stat strong{color:#1e293b;}
  .nav-right{display:flex; gap:10px; align-items:center;}
  .switch{display:flex; gap:6px; align-items:center; font-size:13px; color:#475569; cursor:pointer;}
  .switch input{accent-color:#6366f1;}
  .btn{padding:7px 12px; border-radius:999px; border:1px solid #e2e8f0; background:#fff; font-size:13px; font-weight:500; cursor:pointer; text-decoration:none; color:#1e293b;}
  .btn:hover{background:#f8fafc; border-color:#cbd5e1;}
  .btn.ghost{background:#fff;}
  .btn.small{padding:5px 10px; font-size:12px;}
  .btn.icon{width:32px; height:32px; padding:0; display:grid; place-items:center;}

  /* hero — subtle glass but solid */
  .hero{
    margin:20px 0 16px; display:grid; grid-template-columns: 1.35fr .65fr; gap:16px; align-items:center;
    background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border:1px solid #e2e8f0; border-radius:16px; padding:20px;
  }
  .hero h1{margin:0; font-size:26px; letter-spacing:-.03em; line-height:1.15;}
  .accent{color:#6366f1;}
  .hero p{margin:8px 0 0; color:#64748b; font-size:13px; line-height:1.5;}
  .hero-stats{display:grid; grid-template-columns: repeat(4,1fr); gap:10px;}
  .hcard{background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:12px; text-align:center; box-shadow: 0 1px 2px rgba(0,0,0,0.04);}
  .hcard-num{font-size:22px; font-weight:700; letter-spacing:-.02em; line-height:1;}
  .hcard.running .hcard-num{color:#6366f1} .hcard.success .hcard-num{color:#059669} .hcard.failed .hcard-num{color:#dc2626}
  .hcard-label{font-size:10px; font-weight:600; letter-spacing:.08em; color:#64748b; margin-top:4px;}

  .grid{display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px; margin:12px 0;}
  .card{background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:14px; box-shadow: 0 1px 2px rgba(0,0,0,0.04);}
  .card-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;}
  .card-head h3{margin:0; font-size:11px; font-weight:700; letter-spacing:.08em; color:#64748b; text-transform:uppercase;}
  .badge{font-size:11px; padding:4px 8px; border-radius:999px; background:#f1f5f9; border:1px solid #e2e8f0; color:#475569; font-weight:500;}
  .queue{display:flex; flex-direction:column; gap:10px;}
  .bar-row{display:flex; gap:10px; align-items:center; font-size:13px;}
  .bar-label{font-size:12px; color:#475569; min-width:48px;}
  .bar{flex:1; height:8px; background:#f1f5f9; border-radius:999px; overflow:hidden; border:1px solid #e2e8f0;}
  .bar.thin{height:6px;}
  .fill{height:100%; background: #6366f1; transition: width .6s ease;}
  .fill.amber{background:#f59e0b;}
  .queue-running{font-size:13px; color:#64748b;}
  .chip{background:#f1f5f9; border:1px solid #e2e8f0; padding:3px 8px; border-radius:999px; font-size:12px;}
  .empty{text-align:center; padding:18px; color:#64748b;}
  .empty-icon{font-size:20px; margin-bottom:6px;}
  .empty-title{font-weight:600; color:#1e293b; font-size:13px;}
  .empty-desc{font-size:11px; margin-top:4px; line-height:1.4;}
  .card-foot{margin-top:12px; padding-top:10px; border-top:1px solid #f1f5f9; font-size:11px; color:#94a3b8;}
  .sched-list{display:flex; flex-direction:column; gap:6px;}
  .sched{display:flex; gap:8px; align-items:center; font-size:12px; padding:6px 8px; background:#f8fafc; border:1px solid #f1f5f9; border-radius:8px;}
  .pill{padding:2px 8px; border-radius:999px; background:#fff; border:1px solid #e2e8f0; font-size:11px; font-weight:500;}
  .filter{display:flex; flex-direction:column; gap:12px;}
  .search{position:relative; display:flex; align-items:center; min-height:36px;}
  .search-icon{position:absolute; left:12px; color:#94a3b8; font-size:14px; pointer-events:none; z-index:1;}
  .search input{width:100%; height:36px; padding:0 12px 0 34px; border-radius:999px; border:1px solid #e2e8f0; background:#f8fafc; outline:none; font-size:13px; line-height:36px;}
  .search.focused input{border-color:#6366f1; background:#fff; box-shadow: 0 0 0 3px #6366f122;}
  .pills{display:flex; gap:6px; flex-wrap:wrap; padding-top:2px;}
  .pill-btn{padding:6px 12px; border-radius:999px; border:1px solid #e2e8f0; background:#fff; font-size:12px; cursor:pointer; color:#475569; font-weight:500; line-height:1.2; white-space:nowrap;}
  .pill-btn.active{background:#0f172a; color:#fff; border-color:#0f172a;}
  .filter-meta{display:flex; gap:12px; font-size:11px; color:#64748b; margin-top:2px;}
  .filter-meta span{white-space:nowrap;}

  .layout{display:grid; grid-template-columns: 1.15fr .85fr; gap:12px; margin-top:12px;}
  .panel{background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; display:flex; flex-direction:column; box-shadow: 0 1px 2px rgba(0,0,0,0.04);}
  .panel-head{padding:12px 14px; display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border-bottom:1px solid #e2e8f0;}
  .panel-head h2{margin:0; font-size:11px; font-weight:700; letter-spacing:.08em; color:#64748b; text-transform:uppercase;}
  .table-wrap{overflow:auto; max-height:520px;}
  table{width:100%; border-collapse:collapse; font-size:13px;}
  th{position:sticky; top:0; background:#f8fafc; text-align:left; font-size:11px; font-weight:600; letter-spacing:.06em; color:#64748b; padding:10px 12px; border-bottom:1px solid #e2e8f0; text-transform:uppercase;}
  td{padding:11px 12px; border-bottom:1px solid #f1f5f9; vertical-align:top;}
  tr{cursor:pointer; transition:.12s;}
  tr:hover{background:#f8fafc;}
  tr.selected{background:#eef2ff !important;}
  .repo{font-weight:600; font-size:13px; color:#0f172a;}
  .issue{color:#64748b; font-size:12px; margin-top:2px;}
  .status-pill{display:inline-flex; gap:6px; align-items:center; padding:3px 8px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:.02em;}
  .dot{width:7px; height:7px; border-radius:50%;}
  .phase{font-size:11px; padding:3px 8px; border-radius:999px; background:#f1f5f9; border:1px solid #e2e8f0; color:#475569; font-weight:500;}
  .mono{font-family: ui-monospace, SFMono-Regular, monospace; font-size:12px;}
  .muted{color:#64748b;}
  .small{font-size:11px;}
  .issue.muted{font-size:12px;}
  .detail{display:flex; flex-direction:column;}
  .detail-head{padding:14px; display:flex; justify-content:space-between; gap:12px; border-bottom:1px solid #e2e8f0;}
  .detail-title{font-weight:700; font-size:15px;}
  .detail-sub{font-size:12px; margin-top:2px;}
  .detail-meta{padding:10px 14px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; background:#f8fafc; border-bottom:1px solid #e2e8f0;}
  .status-pill.large{padding:4px 10px; font-size:12px;}
  .detail-grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px; padding:12px 14px; border-bottom:1px solid #e2e8f0; background:#fff;}
  .meta-item{font-size:12px;}
  .meta-item .muted{font-size:11px; text-transform:uppercase; letter-spacing:.06em; font-weight:600;}
  .tabs{display:flex; gap:8px; padding:10px 14px; border-bottom:1px solid #e2e8f0; background:#fff;}
  .tabs .btn{font-size:12px;}
  .logs-wrap{padding:12px; flex:1; display:flex; flex-direction:column; min-height:0; background:#fff;}
  .logs-head{display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; font-size:11px;}
  .live-dot{width:6px; height:6px; border-radius:50%; background:#cbd5e1;}
  .live-dot.on{background:#10b981; box-shadow: 0 0 0 4px #10b98122; animation: pulse 2s infinite;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 #10b98144}70%{box-shadow:0 0 0 6px #10b98100}100%{box-shadow:0 0 0 0 #10b98100}}
  .logs{margin:0; background:#0f172a; color:#e2e8f0; border-radius:10px; padding:12px; max-height: 420px; overflow:auto; white-space:pre-wrap; word-break:break-all; font-size:12px; line-height:1.6; border:1px solid #1e293b;}
  .how{display:grid; gap:8px; margin-top:16px; text-align:left; font-size:12px;}
  .how div{display:flex; gap:10px; align-items:center;}
  .how b{width:20px; height:20px; border-radius:50%; background:#0f172a; color:#fff; display:grid; place-items:center; font-size:11px; flex-shrink:0;}
  .empty.big{padding:32px 20px;}
  .empty.big .empty-icon{font-size:28px;}
  .empty.big .empty-title{font-size:15px;}
  footer{margin-top:14px; display:flex; justify-content:space-between; align-items:center; padding:12px 0; font-size:12px; color:#64748b; border-top:1px solid #e2e8f0;}
  footer a{color:#6366f1; text-decoration:none; font-weight:500;}
  footer a:hover{text-decoration:underline;}
  .links{display:flex; gap:6px;}
  @media (max-width: 960px){ .hero{grid-template-columns:1fr} .hero-stats{grid-template-columns: repeat(2,1fr)} .grid{grid-template-columns:1fr} .layout{grid-template-columns:1fr} }
</style>
