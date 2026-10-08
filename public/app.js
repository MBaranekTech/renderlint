(() => {
  'use strict';

  const state = { projects: [], activeProject: null, scans: [], activeScan: null, filter: 'all', pollToken: 0 };
  let toastTimer = 0;
  const $ = (id) => document.getElementById(id);

  async function request(url, options = {}, expectText = false) {
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    });
    const payload = expectText ? await response.text() : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(expectText ? payload : payload.error || 'Request failed.');
    return payload;
  }

  function toast(message, error = false) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.toggle('error', error);
    $('toast').classList.add('visible');
    toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
  }

  function hostLabel(url) {
    try { return new URL(url).host; } catch { return url; }
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  function downloadScan(path) {
    if (!state.activeScan) return;
    const link = document.createElement('a');
    link.href = `/api/scans/${encodeURIComponent(state.activeScan.id)}/${path}`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function renderProjects() {
    const list = $('project-list');
    list.innerHTML = '';
    $('project-count').textContent = state.projects.length;
    $('project-empty').hidden = state.projects.length > 0;
    state.projects.forEach((project) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `project-item${project.id === state.activeProject?.id ? ' active' : ''}`;
      const avatar = document.createElement('span');
      avatar.className = 'project-avatar';
      avatar.textContent = project.name.slice(0, 1).toUpperCase();
      const copy = document.createElement('span');
      copy.className = 'project-copy';
      const name = document.createElement('strong');
      name.textContent = project.name;
      const host = document.createElement('small');
      host.textContent = hostLabel(project.targetUrl);
      copy.append(name, host);
      const count = document.createElement('b');
      count.textContent = project.scanCount;
      button.append(avatar, copy, count);
      button.addEventListener('click', () => selectProject(project.id));
      list.appendChild(button);
    });
  }

  async function loadProjects(selectId = null) {
    const payload = await request('/api/projects');
    state.projects = payload.projects;
    const preferred = selectId || localStorage.getItem('renderlint:activeProject');
    const project = state.projects.find((item) => item.id === preferred) || state.projects[0] || null;
    state.activeProject = project;
    renderProjects();
    if (project) await selectProject(project.id);
    else showPlaceholder();
  }

  function showPlaceholder() {
    state.activeProject = null;
    state.scans = [];
    state.activeScan = null;
    $('project-placeholder').hidden = false;
    $('project-view').hidden = true;
    renderProjects();
  }

  async function selectProject(id) {
    const project = state.projects.find((item) => item.id === id);
    if (!project) return;
    state.pollToken += 1;
    state.activeProject = project;
    state.activeScan = null;
    $('copy-prompt').disabled = true;
    $('download-brief').disabled = true;
    $('download-json').disabled = true;
    localStorage.setItem('renderlint:activeProject', id);
    renderProjects();
    $('project-placeholder').hidden = true;
    $('project-view').hidden = false;
    $('project-name').textContent = project.name;
    $('project-url').href = project.targetUrl;
    $('project-url').textContent = project.targetUrl;
    await loadScans();
  }

  async function loadScans(selectId = null) {
    if (!state.activeProject) return;
    const projectId = state.activeProject.id;
    const payload = await request(`/api/projects/${projectId}/scans`);
    if (state.activeProject?.id !== projectId) return;
    state.scans = payload.scans;
    renderScanHistory();
    const scan = state.scans.find((item) => item.id === selectId) || state.scans[0] || null;
    if (!scan) {
      state.activeScan = null;
      showNoReport();
      return;
    }
    await loadScan(scan.id);
  }

  function renderScanHistory() {
    const list = $('scan-list');
    list.innerHTML = '';
    state.scans.slice(0, 8).forEach((scan, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `scan-chip ${scan.status}${scan.id === state.activeScan?.id ? ' active' : ''}`;
      button.title = `${formatDate(scan.createdAt)} · ${scan.status}`;
      button.textContent = scan.status === 'running' || scan.status === 'queued' ? '' : String(state.scans.length - index).padStart(2, '0');
      button.addEventListener('click', () => loadScan(scan.id));
      list.appendChild(button);
    });
  }

  function showNoReport() {
    $('scan-state').hidden = true;
    $('report-empty').hidden = false;
    $('report').hidden = true;
    $('scan-meta').textContent = 'No scans yet.';
    $('copy-prompt').disabled = true;
    $('download-brief').disabled = true;
    $('download-json').disabled = true;
  }

  async function loadScan(id) {
    const payload = await request(`/api/scans/${id}`);
    if (!state.activeProject || payload.scan.projectId !== state.activeProject.id) return;
    state.activeScan = payload.scan;
    renderScanHistory();
    $('scan-meta').textContent = `${formatDate(payload.scan.createdAt)} · ${payload.scan.status}`;
    if (['queued', 'running'].includes(payload.scan.status)) {
      showScanning();
      pollScan(id, ++state.pollToken);
    } else if (payload.scan.status === 'failed') {
      showFailed(payload.scan.error);
    } else {
      renderReport(payload.scan);
    }
  }

  function showScanning() {
    $('scan-state').hidden = false;
    $('scan-state').classList.remove('failed');
    $('scan-state-title').textContent = 'Scanning website';
    $('scan-state-copy').textContent = 'Opening Chromium at mobile, tablet, and desktop sizes…';
    $('report-empty').hidden = true;
    $('report').hidden = true;
    $('run-scan').disabled = true;
    $('copy-prompt').disabled = true;
    $('download-brief').disabled = true;
    $('download-json').disabled = true;
  }

  function showFailed(message) {
    $('scan-state').hidden = false;
    $('scan-state').classList.add('failed');
    $('scan-state-title').textContent = 'Preflight failed';
    $('scan-state-copy').textContent = message || 'The scanner could not complete this run.';
    $('report-empty').hidden = true;
    $('report').hidden = true;
    $('run-scan').disabled = false;
    $('copy-prompt').disabled = true;
    $('download-brief').disabled = true;
    $('download-json').disabled = true;
  }

  async function pollScan(id, token) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    if (token !== state.pollToken || state.activeScan?.id !== id) return;
    try {
      const payload = await request(`/api/scans/${id}`);
      if (token !== state.pollToken) return;
      state.activeScan = payload.scan;
      if (['queued', 'running'].includes(payload.scan.status)) {
        $('scan-meta').textContent = `${formatDate(payload.scan.createdAt)} · ${payload.scan.status}`;
        pollScan(id, token);
      } else if (payload.scan.status === 'completed') {
        await loadProjects(state.activeProject.id);
        toast(`Preflight complete: ${payload.scan.summary.total} findings.`);
      } else {
        showFailed(payload.scan.error);
      }
    } catch (error) {
      toast(error.message, true);
      $('run-scan').disabled = false;
    }
  }

  function renderReport(scan) {
    $('scan-state').hidden = true;
    $('report-empty').hidden = true;
    $('report').hidden = false;
    $('run-scan').disabled = false;
    $('copy-prompt').disabled = false;
    $('download-brief').disabled = false;
    $('download-json').disabled = false;
    $('summary-total').textContent = scan.summary.total;
    ['critical', 'high', 'medium', 'low'].forEach((severity) => {
      $(`summary-${severity}`).textContent = scan.summary.bySeverity[severity] || 0;
    });

    const evidenceGrid = $('evidence-grid');
    evidenceGrid.innerHTML = '';
    scan.evidence.forEach((item) => {
      const link = document.createElement('a');
      link.className = 'evidence-card';
      link.href = item.screenshot;
      link.target = '_blank';
      link.rel = 'noreferrer';
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = item.screenshot;
      image.alt = `${item.viewport} screenshot of ${item.pageTitle || scan.targetUrl}`;
      image.loading = 'lazy';
      figure.appendChild(image);
      const meta = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = item.viewport;
      const size = document.createElement('small');
      size.textContent = `${item.width}×${item.height}`;
      meta.append(name, size);
      link.append(figure, meta);
      evidenceGrid.appendChild(link);
    });

    const categories = [...new Set(scan.issues.map((issue) => issue.category))].sort();
    const filter = $('issue-filter');
    filter.innerHTML = '<option value="all">All categories</option>';
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category;
      option.textContent = category[0].toUpperCase() + category.slice(1);
      filter.appendChild(option);
    });
    if (!categories.includes(state.filter)) state.filter = 'all';
    filter.value = state.filter;
    renderIssues();
  }

  function renderIssues() {
    const list = $('issue-list');
    list.innerHTML = '';
    if (!state.activeScan?.issues) return;
    const issues = state.activeScan.issues.filter((issue) => state.filter === 'all' || issue.category === state.filter);
    if (!issues.length) {
      const empty = document.createElement('p');
      empty.className = 'no-findings';
      empty.textContent = 'No findings in this category.';
      list.appendChild(empty);
      return;
    }
    issues.forEach((issue) => {
      const article = document.createElement('article');
      article.className = 'issue';
      const severity = document.createElement('span');
      severity.className = `severity ${issue.severity}`;
      severity.textContent = issue.severity;
      const copy = document.createElement('div');
      copy.className = 'issue-copy';
      const title = document.createElement('h4');
      title.textContent = issue.title;
      const heading = document.createElement('div');
      heading.className = 'issue-heading';
      const copyButton = document.createElement('button');
      copyButton.className = 'copy-finding';
      copyButton.type = 'button';
      copyButton.textContent = 'Copy finding';
      copyButton.addEventListener('click', async () => {
        const finding = [
          `## [${issue.severity.toUpperCase()}] ${issue.title}`,
          `Category: ${issue.category}`,
          `Rule: ${issue.rule}`,
          `Viewport(s): ${issue.viewports.join(', ')}`,
          `Selector: ${issue.selector}`,
          `Evidence: ${issue.detail}`,
        ].join('\n');
        try {
          await copyText(finding);
          toast('Finding copied.');
        } catch (error) {
          toast(error.message, true);
        }
      });
      heading.append(title, copyButton);
      const detail = document.createElement('p');
      detail.textContent = issue.detail;
      const selector = document.createElement('code');
      selector.className = 'selector';
      selector.textContent = issue.selector;
      copy.append(heading, detail, selector);
      const meta = document.createElement('span');
      meta.className = 'issue-meta';
      meta.textContent = `${issue.category} · ${issue.viewports.join(', ')}`;
      article.append(severity, copy, meta);
      list.appendChild(article);
    });
  }

  $('project-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    button.disabled = true;
    try {
      const payload = await request('/api/projects', {
        method: 'POST', body: JSON.stringify({ name: data.get('name'), targetUrl: data.get('targetUrl') }),
      });
      form.reset();
      await loadProjects(payload.project.id);
      toast('Project created. Run its first preflight.');
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  $('use-demo').addEventListener('click', () => {
    const form = $('project-form');
    form.elements.name.value = 'Broken demo';
    form.elements.targetUrl.value = new URL('demo.html', location.href).href;
    form.elements.name.focus();
  });

  async function runScan() {
    if (!state.activeProject) return;
    $('run-scan').disabled = true;
    try {
      const payload = await request('/api/scans', {
        method: 'POST', body: JSON.stringify({ projectId: state.activeProject.id }),
      });
      state.scans.unshift(payload.scan);
      state.activeScan = payload.scan;
      renderScanHistory();
      showScanning();
      pollScan(payload.scan.id, ++state.pollToken);
    } catch (error) {
      toast(error.message, true);
      $('run-scan').disabled = false;
    }
  }

  $('run-scan').addEventListener('click', runScan);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey) || event.repeat) return;
    if (!state.activeProject || $('run-scan').disabled) return;
    event.preventDefault();
    runScan();
  });

  $('copy-prompt').addEventListener('click', async () => {
    if (!state.activeScan) return;
    try {
      const prompt = await request(`/api/scans/${state.activeScan.id}/prompt`, {}, true);
      await copyText(prompt);
      toast('Agent repair brief copied.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  $('download-brief').addEventListener('click', () => {
    downloadScan('brief');
    toast('Repair brief download started.');
  });

  $('download-json').addEventListener('click', () => {
    downloadScan('report');
    toast('JSON report download started.');
  });

  $('delete-project').addEventListener('click', async () => {
    if (!state.activeProject || !confirm(`Delete ${state.activeProject.name} and all scan evidence?`)) return;
    try {
      await request(`/api/projects/${state.activeProject.id}`, { method: 'DELETE' });
      localStorage.removeItem('renderlint:activeProject');
      await loadProjects();
      toast('Project deleted.');
    } catch (error) {
      toast(error.message, true);
    }
  });

  $('issue-filter').addEventListener('change', (event) => {
    state.filter = event.target.value;
    renderIssues();
  });

  loadProjects().catch((error) => toast(error.message, true));
})();
