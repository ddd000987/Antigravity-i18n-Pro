// Frontend controller for Antigravity-i18n-Pro.
//
// Field naming follows what Wails actually puts on the wire: types declared
// with json tags (LocaleInfo, FileReport, TemplateSummary, ReapplyHint,
// UIInfo ...) arrive lower camel case, while plain structs (Status,
// ApplyResult, RestoreResult) arrive with their Go field names.
//
// Every user-visible string lives in frontend/dist/i18n/<code>.json and is read
// through t(). Anything that can change with the language is rendered from
// stored state by a render function, so switching language re-renders the whole
// window without asking the backend again.
(function () {
  'use strict';

  var MAX_ISSUES_SHOWN = 50;
  var KEY_DISPLAY_LENGTH = 60;

  var currentStatus = null;
  // When there is no status, statusProblem says why: {label(), desc()}.
  var statusProblem = null;
  var locales = [];
  var localesState = 'loading';
  var selectedLocale = '';
  var isOperating = false;
  var operationLogs = [];

  // Interface language state. messages maps a language code to its id -> text
  // table; savedUILanguage is the stored choice ('' follows the system).
  var messages = {};
  var uiLanguages = [];
  var savedUILanguage = '';
  var currentUILanguage = 'en';

  var reapplyHint = null;
  var reapplyDismissed = false;
  var lastReport = null;
  var lastExport = null;
  var lastUpdate = null;
  // Closures returning the current progress texts, so a language switch in the
  // middle of an operation re-translates them.
  var progressStage = null;
  var progressDetail = null;

  function byId(id) { return document.getElementById(id); }

  var elAppVersionBadge = byId('appVersionBadge');
  var elAppVersion = byId('appVersion');
  var elAppPathDisplay = byId('appPathDisplay');
  var elBtnChangePath = byId('btnChangePath');
  var elBtnAbout = byId('btnAbout');
  var elUiLanguage = byId('uiLanguageSelect');
  var elStatusCard = byId('statusCard');
  var elStatusPill = byId('statusPill');
  var elStatusLabel = byId('statusLabel');
  var elStatusDesc = byId('statusDesc');
  var elProgressBox = byId('progressBox');
  var elProgressStage = byId('progressStage');
  var elProgressDetail = byId('progressDetail');
  var elBtnPrimaryAction = byId('btnPrimaryAction');
  var elBtnSecondaryAction = byId('btnSecondaryAction');
  var elBtnRestore = byId('btnRestore');
  var elReapplyBanner = byId('reapplyBanner');
  var elReapplyText = byId('reapplyText');
  var elBtnReapply = byId('btnReapply');
  var elBtnReapplyLoad = byId('btnReapplyLoad');
  var elBtnReapplyDismiss = byId('btnReapplyDismiss');
  var elLocaleChips = byId('localeChips');
  var elLocaleNote = byId('localeNote');
  var elExportFrom = byId('exportFromSelect');
  var elBtnExportTemplate = byId('btnExportTemplate');
  var elExportResult = byId('exportResult');
  var elBtnLoadFile = byId('btnLoadFile');
  var elReportPanel = byId('reportPanel');
  var elReportTitle = byId('reportTitle');
  var elReportBadge = byId('reportBadge');
  var elReportPath = byId('reportPath');
  var elReportBarFill = byId('reportBarFill');
  var elReportPercent = byId('reportPercent');
  var elReportSections = byId('reportSections');
  var elReportIssuesTitle = byId('reportIssuesTitle');
  var elReportIssues = byId('reportIssues');
  var elReportMissingHint = byId('reportMissingHint');
  var elReportUnknownHint = byId('reportUnknownHint');
  var elReportBlocked = byId('reportBlocked');
  var elBtnApplyFile = byId('btnApplyFile');
  var elBtnUpdateTemplate = byId('btnUpdateTemplate');
  var elUpdateResult = byId('updateResult');
  var elBtnToggleLogs = byId('btnToggleLogs');
  var elLogDrawer = byId('logDrawer');
  var elLogContent = byId('logContent');
  var elBtnCopyLogs = byId('btnCopyLogs');
  var elBtnCloseLogs = byId('btnCloseLogs');
  var elAboutModal = byId('aboutModal');
  var elBtnCloseAbout = byId('btnCloseAbout');
  var elApplyConfirmModal = byId('applyConfirmModal');
  var elApplyConfirmTitle = byId('applyConfirmTitle');
  var elApplyConfirmBody = byId('applyConfirmBody');
  var elBtnCancelApply = byId('btnCancelApply');
  var elBtnConfirmApply = byId('btnConfirmApply');
  var elMsgModal = byId('msgModal');
  var elMsgTitle = byId('msgTitle');
  var elMsgBody = byId('msgBody');
  var elBtnMsgOk = byId('btnMsgOk');

  function backend() {
    return window.go && window.go.main && window.go.main.App ? window.go.main.App : null;
  }

  // ---------------------------------------------------------------------------
  // Interface language
  // ---------------------------------------------------------------------------

  // lookup finds an id in the chosen language, then in English. An empty string
  // counts as missing so a half-finished language file degrades to English.
  function lookup(id) {
    var table = messages[currentUILanguage];
    if (table && typeof table[id] === 'string' && table[id] !== '') return table[id];
    var english = messages.en;
    if (english && typeof english[id] === 'string' && english[id] !== '') return english[id];
    return null;
  }

  function format(text, params) {
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (whole, name) {
      return Object.prototype.hasOwnProperty.call(params, name) && params[name] !== undefined && params[name] !== null
        ? String(params[name])
        : whole;
    });
  }

  // t translates an id, falling back to the id itself.
  function t(id, params) {
    var text = lookup(id);
    return format(text === null ? id : text, params);
  }

  // tOr is t with a caller-supplied fallback, for ids that come from the
  // backend (such as progress stages) and may not have a translation yet.
  function tOr(id, fallback, params) {
    var text = lookup(id);
    return format(text === null ? fallback : text, params);
  }

  function systemLanguages() {
    var out = [];
    if (navigator.languages && navigator.languages.length) {
      for (var i = 0; i < navigator.languages.length; i++) out.push(navigator.languages[i]);
    } else if (navigator.language) {
      out.push(navigator.language);
    }
    return out;
  }

  // chineseVariant maps the subtags of a zh-* tag to the bundled Chinese file
  // it should use: Traditional for Hant/TW/HK/MO, Simplified otherwise.
  function chineseVariant(rest) {
    var i;
    for (i = 0; i < rest.length; i++) {
      if (rest[i] === 'hant') return 'zh-tw';
      if (rest[i] === 'hans') return 'zh-cn';
    }
    for (i = 0; i < rest.length; i++) {
      if (rest[i] === 'tw' || rest[i] === 'hk' || rest[i] === 'mo') return 'zh-tw';
      if (rest[i] === 'cn' || rest[i] === 'sg') return 'zh-cn';
    }
    return 'zh-cn';
  }

  function findIgnoringCase(available, wanted) {
    for (var i = 0; i < available.length; i++) {
      if (available[i].toLowerCase() === wanted) return available[i];
    }
    return '';
  }

  // matchLanguage maps one system language tag to an available language code,
  // or '' when none fits.
  function matchLanguage(tag, available) {
    var low = String(tag || '').toLowerCase().replace(/_/g, '-');
    if (!low) return '';
    var found = findIgnoringCase(available, low);
    if (found) return found;
    var parts = low.split('-');
    var primary = parts[0];
    if (primary === 'zh') {
      found = findIgnoringCase(available, chineseVariant(parts.slice(1)));
      if (found) return found;
    }
    found = findIgnoringCase(available, primary);
    if (found) return found;
    for (var i = 0; i < available.length; i++) {
      if (available[i].toLowerCase().split('-')[0] === primary) return available[i];
    }
    return '';
  }

  // chooseLanguage applies the saved setting, then the system language, then
  // English.
  function chooseLanguage() {
    if (savedUILanguage && messages[savedUILanguage]) return savedUILanguage;
    var system = systemLanguages();
    for (var i = 0; i < system.length; i++) {
      var match = matchLanguage(system[i], uiLanguages);
      if (match) return match;
    }
    return 'en';
  }

  function applyUIInfo(info) {
    messages = (info && info.messages) || {};
    savedUILanguage = (info && info.saved) || '';
    uiLanguages = Object.keys(messages).sort(function (a, b) {
      if (a === 'en') return -1;
      if (b === 'en') return 1;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    currentUILanguage = chooseLanguage();
  }

  function applyStaticTexts() {
    // With no message tables at all the markup's own English text is the best
    // there is, so it is left alone.
    if (!uiLanguages.length) return;
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-title]'), function (node) {
      node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
    });
    document.documentElement.lang = currentUILanguage;
  }

  function makeOption(value, text) {
    var option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    return option;
  }

  function renderUILanguageSelect() {
    elUiLanguage.innerHTML = '';
    elUiLanguage.appendChild(makeOption('', t('language.system')));
    uiLanguages.forEach(function (code) {
      var table = messages[code] || {};
      elUiLanguage.appendChild(makeOption(code, table['language.selfName'] || code));
    });
    elUiLanguage.value = savedUILanguage && messages[savedUILanguage] ? savedUILanguage : '';
  }

  function renderAll() {
    applyStaticTexts();
    renderUILanguageSelect();
    renderStatus();
    renderChips();
    renderExportOptions();
    renderReapply();
    renderExportResult();
    renderReport();
    renderUpdateResult();
    renderProgress();
    renderLogs();
  }

  function handleUILanguageChange() {
    var code = elUiLanguage.value || '';
    savedUILanguage = code;
    currentUILanguage = chooseLanguage();
    renderAll();
    var app = backend();
    if (app && app.SetUILanguage) {
      app.SetUILanguage(code).catch(function (err) {
        appendLog('[error] could not remember the interface language: ' + errorText(err));
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  function errorText(err) {
    if (!err) return t('error.unknown');
    if (typeof err === 'string') return err;
    return err.message || String(err);
  }

  // The log is for diagnostics and bug reports, so it stays in English
  // whatever the interface language is.
  function appendLog(line) {
    operationLogs.push(line);
    renderLogs();
    elLogContent.scrollTop = elLogContent.scrollHeight;
  }

  function renderLogs() {
    elLogContent.textContent = operationLogs.length ? operationLogs.join('\n') : t('log.empty');
  }

  function showMessage(title, body) {
    elMsgTitle.textContent = title;
    elMsgBody.textContent = body;
    elMsgModal.classList.remove('hidden');
  }

  function scrollIntoViewSafe(el) {
    if (el && typeof el.scrollIntoView === 'function') {
      try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (err) { /* cosmetic only */ }
    }
  }

  function truncateText(text, max) {
    var chars = Array.from(String(text));
    return chars.length <= max ? String(text) : chars.slice(0, max).join('') + '…';
  }

  function makeNode(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function sectionLabel(section) {
    var s = String(section || '');
    var known = ['text', 'menu', 'dialogs', 'patterns', 'valueMaps', 'file', 'language', 'name'];
    if (known.indexOf(s) >= 0) return t('section.' + s);
    if (s.indexOf('valueRules.') === 0) return t('section.valueRules', { name: s.slice('valueRules.'.length) });
    return s;
  }

  function sectionList(counts) {
    var names = Object.keys(counts || {}).filter(function (k) { return counts[k] > 0; }).sort();
    return names.map(function (k) { return sectionLabel(k) + ' ' + counts[k]; }).join(t('format.listSeparator'));
  }

  function sumCounts(counts) {
    var total = 0;
    Object.keys(counts || {}).forEach(function (k) { total += counts[k] || 0; });
    return total;
  }

  // ---------------------------------------------------------------------------
  // Operation state
  // ---------------------------------------------------------------------------

  function renderProgress() {
    if (progressStage) elProgressStage.textContent = progressStage();
    if (progressDetail) elProgressDetail.textContent = progressDetail();
  }

  // quiet keeps the progress box hidden: used for the quick file operations
  // that are mostly waiting on a native dialog.
  function setOperatingState(operating, stage, detail, quiet) {
    isOperating = operating;
    if (operating && !quiet) {
      progressStage = stage || function () { return t('op.working'); };
      progressDetail = detail || function () { return t('op.wait'); };
      renderProgress();
      elProgressBox.classList.remove('hidden');
      scrollIntoViewSafe(elStatusCard);
    } else {
      elProgressBox.classList.add('hidden');
    }
    [
      elBtnPrimaryAction, elBtnSecondaryAction, elBtnRestore, elBtnChangePath,
      elBtnReapply, elBtnReapplyLoad, elExportFrom, elBtnExportTemplate,
      elBtnLoadFile, elBtnApplyFile, elBtnUpdateTemplate
    ].forEach(function (btn) {
      btn.disabled = operating;
    });
    Array.prototype.forEach.call(elLocaleChips.querySelectorAll('.chip'), function (chip) {
      chip.disabled = operating;
    });
  }

  function isPatched(st) {
    return !!(st && st.CurrentLanguage && st.CurrentLanguage !== 'en');
  }

  // ---------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------

  function refreshStatus() {
    var app = backend();
    if (!app) {
      currentStatus = null;
      statusProblem = {
        label: function () { return t('status.noBackend'); },
        desc: function () { return t('status.noBackendDesc'); }
      };
      renderStatus();
      return Promise.resolve();
    }
    return app.GetStatus().then(function (st) {
      currentStatus = st;
      statusProblem = null;
      renderStatus();
      renderChips();
    }).catch(function (err) {
      currentStatus = null;
      var msg = errorText(err);
      statusProblem = {
        label: function () { return t('status.readFailed'); },
        desc: function () { return msg; }
      };
      renderStatus();
      appendLog('[error] could not read the status: ' + msg);
    });
  }

  function renderStatus() {
    var st = currentStatus;
    elStatusPill.className = 'status-pill';
    elBtnSecondaryAction.classList.add('hidden');
    elBtnRestore.classList.add('hidden');
    elBtnSecondaryAction.textContent = t('btn.openApp');

    if (!st) {
      if (statusProblem) {
        elStatusPill.classList.add('danger');
        elStatusLabel.textContent = statusProblem.label();
        elStatusDesc.textContent = statusProblem.desc();
        elAppPathDisplay.textContent = t('app.pathMissing');
        elAppVersion.textContent = t('app.versionUnknown');
      } else {
        elStatusLabel.textContent = t('status.detecting');
        elStatusDesc.textContent = t('status.detectingDesc');
        elAppPathDisplay.textContent = t('app.pathDetecting');
        elAppVersion.textContent = t('app.versionDetecting');
      }
      elAppPathDisplay.title = '';
      elBtnPrimaryAction.textContent = t('btn.apply');
      return;
    }

    elAppPathDisplay.textContent = st.AppDir || t('app.pathMissing');
    elAppPathDisplay.title = st.AppDir || '';
    elAppVersion.textContent = st.AppVersion ? 'v' + st.AppVersion : t('app.versionUnknown');

    var desc;
    if (isPatched(st)) {
      elStatusPill.classList.add('success');
      elStatusLabel.textContent = t('status.localized', { code: st.CurrentLanguage });
      desc = t('status.descPatched', { name: st.LocaleName || st.CurrentLanguage });
      elBtnPrimaryAction.textContent = t('btn.reapply');
      elBtnSecondaryAction.classList.remove('hidden');
      elBtnRestore.classList.remove('hidden');
    } else if (st.HasCleanBackup) {
      elStatusPill.classList.add('default');
      elStatusLabel.textContent = t('status.official');
      desc = t('status.descBackup');
      elBtnPrimaryAction.textContent = t('btn.apply');
      elBtnSecondaryAction.classList.remove('hidden');
    } else {
      elStatusPill.classList.add('warning');
      elStatusLabel.textContent = t('status.official');
      desc = t('status.descNoBackup');
      elBtnPrimaryAction.textContent = t('btn.apply');
    }

    var sentences = [desc];
    if (st.CleanBackupStatus && st.CleanBackupStatus !== 'valid') {
      sentences.push(t('status.backupState', { status: st.CleanBackupStatus }));
    }
    if (st.StateIsStale) {
      sentences.push(t('status.stale'));
    }
    elStatusDesc.textContent = sentences.join(' ');
  }

  // The button names the locale the click will install, not the one already
  // installed. Saying "Apply Chinese" while the selection is Japanese
  // misreports what the next click does.
  function selectedLabel() {
    for (var i = 0; i < locales.length; i++) {
      if (locales[i].code === selectedLocale) return locales[i].name;
    }
    return selectedLocale;
  }

  function renderPrimaryLabel() {
    var label = selectedLocale === 'en' ? 'English' : selectedLabel();
    if (isPatched(currentStatus)) {
      elBtnPrimaryAction.textContent = currentStatus.CurrentLanguage === selectedLocale
        ? t('btn.reapplyNamed', { name: label })
        : t('btn.switchTo', { name: label });
      return;
    }
    elBtnPrimaryAction.textContent = selectedLocale === 'en'
      ? t('btn.keepEnglish')
      : t('btn.applyNamed', { name: label });
  }

  function renderChips() {
    elLocaleChips.innerHTML = '';
    if (!locales.length) {
      elLocaleNote.textContent = localesState === 'failed'
        ? t('locale.loadFailed')
        : (localesState === 'loading' ? t('locale.loading') : t('locale.none'));
      return;
    }
    var patched = isPatched(currentStatus);
    locales.forEach(function (loc) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip' + (loc.coverage < 100 ? ' partial' : '');
      chip.setAttribute('aria-pressed', String(loc.code === selectedLocale));
      chip.disabled = isOperating;
      chip.title = loc.englishName;

      var name = document.createElement('span');
      name.textContent = loc.name;
      var cov = document.createElement('span');
      cov.className = 'cov';
      cov.textContent = loc.coverage + '%';
      chip.appendChild(name);
      chip.appendChild(cov);

      chip.addEventListener('click', function () {
        selectedLocale = loc.code;
        renderChips();
      });
      elLocaleChips.appendChild(chip);
    });
    elLocaleNote.textContent = patched
      ? t('locale.notePatched')
      : t('locale.noteUnpatched', { count: locales.length });
    renderPrimaryLabel();
  }

  function loadLocales() {
    var app = backend();
    if (!app) return Promise.resolve();
    return app.GetLocales().then(function (list) {
      locales = list || [];
      localesState = 'ready';
      if (!selectedLocale) {
        // English leads the list, so the fallback must name a real language pack
        // rather than whichever entry happens to be first.
        selectedLocale = isPatched(currentStatus)
          ? currentStatus.CurrentLanguage
          : 'zh-TW';
      }
      renderChips();
      renderExportOptions();
    }).catch(function (err) {
      localesState = 'failed';
      renderChips();
      appendLog('[error] could not read the language list: ' + errorText(err));
    });
  }

  // ---------------------------------------------------------------------------
  // Apply and restore
  // ---------------------------------------------------------------------------

  // Both apply and restore stop Antigravity, and the process is killed outright
  // once the graceful window expires, so the user is asked before anything is
  // touched. The backend refuses to run without confirmation as well.
  function confirmAction(title, kind, onConfirm) {
    elApplyConfirmTitle.textContent = title;
    elApplyConfirmBody.textContent = kind === 'restore' ? t('confirm.bodyRestore') : t('confirm.bodyApply');
    elBtnConfirmApply.onclick = onConfirm;
    elApplyConfirmModal.classList.remove('hidden');
  }

  function closeConfirm() {
    elApplyConfirmModal.classList.add('hidden');
    elBtnConfirmApply.onclick = null;
  }

  function doApply() {
    if (isOperating) return;
    var app = backend();
    if (!app) return;
    var code = selectedLocale || 'zh-TW';

    // English is not a language pack: it is the untranslated build that restore
    // reinstalls. Routing it through apply could only fail on an unknown locale.
    if (code === 'en') {
      confirmAction(t('confirm.keepEnglishTitle'), 'restore', function () {
        closeConfirm();
        doRestore();
      });
      return;
    }

    confirmAction(t('confirm.switchTitle', { name: selectedLabel() }), 'apply', function () {
      closeConfirm();
      runApply(app, code, function () { return app.ApplyLocale(code, true); });
    });
  }

  // runApply is shared by every way of installing a language: a bundled pack, a
  // language file and the reapply reminder.
  function runApply(app, label, call) {
    setOperatingState(true,
      function () { return t('op.applying'); },
      function () { return t('op.applyingDetail'); });
    appendLog('[op] applying ' + label);

    call().then(function (res) {
      var name = res && res.LocaleName ? res.LocaleName : label;
      appendLog('[done] applied ' + name);
      reapplyHint = null;
      renderReapply();
      if (res && res.Relaunched) {
        showMessage(t('msg.appliedTitle'), t('msg.appliedRelaunched', { name: name }));
      } else {
        showMessage(t('msg.appliedTitle'), t('msg.appliedManual', { name: name }));
      }
    }).catch(function (err) {
      var msg = errorText(err);
      appendLog('[error] ' + msg);
      showMessage(t('msg.applyFailed'), msg);
    }).then(function () {
      setOperatingState(false);
      return refreshStatus();
    });
  }

  function doRestore() {
    if (isOperating) return;
    var app = backend();
    if (!app) return;

    setOperatingState(true,
      function () { return t('op.restoring'); },
      function () { return t('op.restoringDetail'); });
    appendLog('[op] restoring the official English build');

    app.RestoreLocale(true).then(function (res) {
      appendLog('[done] restored the official English build');
      reapplyHint = null;
      renderReapply();
      if (res && res.AlreadyEnglish) {
        showMessage(t('msg.restoredTitle'), t('msg.restoredAlready'));
      } else if (res && !res.Relaunched) {
        showMessage(t('msg.restoredTitle'), t('msg.restoredManual'));
      } else {
        showMessage(t('msg.restoredTitle'), t('msg.restored'));
      }
    }).catch(function (err) {
      var msg = errorText(err);
      appendLog('[error] ' + msg);
      showMessage(t('msg.restoreFailed'), msg);
    }).then(function () {
      setOperatingState(false);
      return refreshStatus();
    });
  }

  function launchApp() {
    var app = backend();
    if (!app) return;
    app.LaunchAntigravity().then(function () {
      appendLog('[op] launched Antigravity');
    }).catch(function (err) {
      showMessage(t('msg.launchFailed'), errorText(err));
    });
  }

  function handlePrimaryAction() {
    if (isOperating) return;
    if (!currentStatus) {
      refreshStatus();
      return;
    }
    if (!currentStatus.AppDir) {
      handleChangePath();
      return;
    }
    doApply();
  }

  function handleChangePath() {
    var app = backend();
    if (!app) return;
    app.SelectAppDir(t('dialog.selectAppDir')).then(function (selected) {
      if (!selected) return null;
      setOperatingState(true,
        function () { return t('op.changingPath'); },
        function () { return selected; });
      return app.SetAppDir(selected).then(function (st) {
        currentStatus = st;
        statusProblem = null;
        renderStatus();
        return refreshStatus();
      }).then(function () {
        reapplyDismissed = false;
        return refreshReapplyHint();
      });
    }).catch(function (err) {
      var msg = errorText(err);
      appendLog('[error] ' + msg);
      showMessage(t('msg.pathFailed'), msg);
    }).then(function () {
      setOperatingState(false);
    });
  }

  // ---------------------------------------------------------------------------
  // Reapply reminder
  // ---------------------------------------------------------------------------

  function refreshReapplyHint() {
    var app = backend();
    if (!app || !app.GetReapplyHint) return Promise.resolve();
    return app.GetReapplyHint().then(function (hint) {
      reapplyHint = hint && hint.needed ? hint : null;
      renderReapply();
    }).catch(function (err) {
      reapplyHint = null;
      renderReapply();
      appendLog('[error] could not read the reapply hint: ' + errorText(err));
    });
  }

  function renderReapply() {
    if (!reapplyHint || reapplyDismissed) {
      elReapplyBanner.classList.add('hidden');
      return;
    }
    var hint = reapplyHint;
    var params = {
      appVersion: hint.appVersion || '',
      name: hint.name || hint.locale || '',
      localeFile: hint.localeFile || ''
    };
    var text;
    if (hint.fileMissing) {
      text = hint.appVersion ? t('reapply.missing', params) : t('reapply.missingNoVersion', params);
      elBtnReapply.classList.add('hidden');
      elBtnReapplyLoad.classList.remove('hidden');
    } else {
      text = hint.appVersion ? t('reapply.text', params) : t('reapply.textNoVersion', params);
      elBtnReapply.classList.remove('hidden');
      elBtnReapplyLoad.classList.add('hidden');
    }
    elReapplyText.textContent = text;
    elReapplyBanner.classList.remove('hidden');
  }

  function handleReapply() {
    if (isOperating || !reapplyHint) return;
    var app = backend();
    if (!app) return;
    var name = reapplyHint.name || reapplyHint.locale || '';
    confirmAction(t('confirm.reapplyTitle', { name: name }), 'apply', function () {
      closeConfirm();
      runApply(app, name, function () { return app.Reapply(true); });
    });
  }

  // ---------------------------------------------------------------------------
  // Custom language file
  // ---------------------------------------------------------------------------

  function renderExportOptions() {
    var previous = elExportFrom.value || '';
    elExportFrom.innerHTML = '';
    elExportFrom.appendChild(makeOption('', t('custom.export.blank')));
    var keep = false;
    locales.forEach(function (loc) {
      if (loc.code === 'en') return;
      elExportFrom.appendChild(makeOption(loc.code, t('custom.export.prefill', { name: loc.name })));
      if (loc.code === previous) keep = true;
    });
    elExportFrom.value = keep ? previous : '';
  }

  function renderExportResult() {
    if (!lastExport) {
      elExportResult.classList.add('hidden');
      return;
    }
    elExportResult.textContent = t('custom.export.done', {
      path: lastExport.path,
      entries: lastExport.entries
    });
    elExportResult.title = lastExport.path || '';
    elExportResult.classList.remove('hidden');
  }

  function handleExport() {
    if (isOperating) return;
    var app = backend();
    if (!app) return;
    var from = elExportFrom.value || '';
    setOperatingState(true, null, null, true);
    app.ExportTemplate(from, t('dialog.exportTitle')).then(function (res) {
      if (!res) return; // the save dialog was cancelled
      lastExport = res;
      renderExportResult();
      appendLog('[done] exported a template to ' + res.path);
    }).catch(function (err) {
      var msg = errorText(err);
      appendLog('[error] ' + msg);
      showMessage(t('msg.exportFailed'), msg);
    }).then(function () {
      setOperatingState(false);
    });
  }

  function handleLoadFile() {
    if (isOperating) return;
    var app = backend();
    if (!app) return;
    setOperatingState(true, null, null, true);
    app.ChooseLocaleFile(t('dialog.chooseFile')).then(function (path) {
      if (!path) return null; // the open dialog was cancelled
      return app.CheckLocaleFile(path).then(function (report) {
        lastReport = report;
        renderReport();
        appendLog('[done] checked ' + path);
        scrollIntoViewSafe(elReportPanel);
      });
    }).catch(function (err) {
      var msg = errorText(err);
      appendLog('[error] ' + msg);
      showMessage(t('msg.checkFailed'), msg);
    }).then(function () {
      setOperatingState(false);
    });
  }

  function issueText(issue) {
    var detail = issue.message || '';
    switch (issue.code) {
      case 'markers':
        return { text: t('issue.markers', { want: issue.want, got: issue.got }), detail: '' };
      case 'placeholders':
        var parts = [];
        if (issue.missing && issue.missing.length) {
          parts.push(t('issue.placeholdersMissing', { list: issue.missing.join(' ') }));
        }
        if (issue.extra && issue.extra.length) {
          parts.push(t('issue.placeholdersExtra', { list: issue.extra.join(' ') }));
        }
        return { text: t('issue.placeholders', { detail: parts.join(t('format.listSeparator')) }), detail: '' };
      case 'meta':
        return { text: t('issue.meta'), detail: detail };
      case 'json':
        return { text: t('issue.json'), detail: detail };
      case 'type':
        return { text: t('issue.type'), detail: detail };
      case 'invalid':
        return { text: t('issue.invalid'), detail: detail };
      case 'unknownRule':
        return { text: t('issue.unknownRule'), detail: detail };
      case 'empty':
        return { text: t('issue.empty'), detail: detail };
      default:
        return { text: detail || String(issue.code || ''), detail: '' };
    }
  }

  function buildIssueItem(issue) {
    var isWarning = issue.severity === 'warning';
    var li = makeNode('li', 'issue ' + (isWarning ? 'warning' : 'error'));

    var head = makeNode('div', 'issue-head');
    head.appendChild(makeNode('span', 'issue-badge', isWarning ? t('report.severityWarning') : t('report.severityError')));
    var where = [];
    if (issue.line > 0) where.push(t('report.line', { n: issue.line }));
    if (issue.section) where.push(sectionLabel(issue.section));
    if (issue.key) where.push(truncateText(issue.key, KEY_DISPLAY_LENGTH));
    head.appendChild(makeNode('span', 'issue-loc', where.join(' · ')));
    li.appendChild(head);

    var texts = issueText(issue);
    li.appendChild(makeNode('div', 'issue-text', texts.text));
    if (texts.detail) li.appendChild(makeNode('div', 'issue-detail', texts.detail));
    return li;
  }

  function buildSectionRow(sec) {
    var row = makeNode('div', 'section-row');
    row.appendChild(makeNode('span', 'section-name', sectionLabel(sec.section)));
    var bar = makeNode('div', 'mini-bar');
    var fill = makeNode('div', 'mini-fill');
    fill.style.width = (sec.total > 0 ? Math.round(sec.done * 100 / sec.total) : 0) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(makeNode('span', 'section-count', sec.done + ' / ' + sec.total));
    return row;
  }

  function renderReport() {
    var report = lastReport;
    if (!report) {
      elReportPanel.classList.add('hidden');
      return;
    }
    elReportPanel.classList.remove('hidden');

    var language = report.language || '';
    var title = report.name
      ? (language ? report.name + ' (' + language + ')' : report.name)
      : (language || t('report.unnamed'));
    elReportTitle.textContent = title;
    elReportPath.textContent = report.path || '';
    elReportPath.title = report.path || '';
    elReportBadge.className = 'report-badge ' + (report.ok ? 'ok' : 'bad');
    elReportBadge.textContent = report.ok ? t('report.badgeOk') : t('report.badgeErrors');

    var progress = report.progress || { sections: [], done: 0, total: 0, percent: 0 };
    elReportBarFill.style.width = (progress.percent || 0) + '%';
    elReportPercent.textContent = t('report.progress', {
      percent: progress.percent || 0,
      done: progress.done || 0,
      total: progress.total || 0
    });

    elReportSections.innerHTML = '';
    (progress.sections || []).forEach(function (sec) {
      elReportSections.appendChild(buildSectionRow(sec));
    });

    // Errors come first because they are what blocks the apply.
    var issues = report.issues || [];
    var errors = issues.filter(function (i) { return i.severity !== 'warning'; });
    var warnings = issues.filter(function (i) { return i.severity === 'warning'; });
    var ordered = errors.concat(warnings);
    elReportIssuesTitle.textContent = ordered.length
      ? t('report.issuesTitle', { errors: errors.length, warnings: warnings.length })
      : t('report.noIssues');
    elReportIssues.innerHTML = '';
    ordered.slice(0, MAX_ISSUES_SHOWN).forEach(function (issue) {
      elReportIssues.appendChild(buildIssueItem(issue));
    });
    if (ordered.length > MAX_ISSUES_SHOWN) {
      elReportIssues.appendChild(makeNode('li', 'issue-more', t('report.more', { n: ordered.length - MAX_ISSUES_SHOWN })));
    }

    if (report.missingKeys > 0) {
      elReportMissingHint.textContent = t('report.missingHint', { n: report.missingKeys });
      elReportMissingHint.classList.remove('hidden');
    } else {
      elReportMissingHint.classList.add('hidden');
    }
    if (report.unknownKeys > 0) {
      elReportUnknownHint.textContent = t('report.unknownHint', { n: report.unknownKeys });
      elReportUnknownHint.classList.remove('hidden');
    } else {
      elReportUnknownHint.classList.add('hidden');
    }

    if (report.ok) {
      elBtnApplyFile.classList.remove('hidden');
      elReportBlocked.classList.add('hidden');
    } else {
      elBtnApplyFile.classList.add('hidden');
      elReportBlocked.classList.remove('hidden');
    }
  }

  function handleApplyFile() {
    if (isOperating || !lastReport || !lastReport.ok) return;
    var app = backend();
    if (!app) return;
    var path = lastReport.path;
    var name = lastReport.name || lastReport.language || path;
    confirmAction(t('confirm.applyFileTitle', { name: name }), 'apply', function () {
      closeConfirm();
      runApply(app, name, function () { return app.ApplyLocaleFile(path, true); });
    });
  }

  function renderUpdateResult() {
    var res = lastUpdate;
    if (!res) {
      elUpdateResult.classList.add('hidden');
      return;
    }
    elUpdateResult.innerHTML = '';
    var added = res.addedTotal || 0;
    elUpdateResult.appendChild(makeNode('div', 'result-line strong',
      added > 0 ? t('update.added', { n: added }) : t('update.nothing')));
    if (res.path) {
      elUpdateResult.appendChild(makeNode('div', 'result-line', t('update.file', { path: res.path })));
    }
    if (added > 0) {
      elUpdateResult.appendChild(makeNode('div', 'result-line', t('update.addedBy', { list: sectionList(res.added) })));
    }
    var obsolete = sumCounts(res.obsolete);
    if (obsolete > 0) {
      elUpdateResult.appendChild(makeNode('div', 'result-line',
        t('update.obsolete', { n: obsolete, list: sectionList(res.obsolete) })));
    }
    if (res.backupPath) {
      elUpdateResult.appendChild(makeNode('div', 'result-line', t('update.backup', { path: res.backupPath })));
    }
    if (res.progress) {
      elUpdateResult.appendChild(makeNode('div', 'result-line', t('update.progress', {
        percent: res.progress.percent || 0,
        done: res.progress.done || 0,
        total: res.progress.total || 0
      })));
    }
    elUpdateResult.classList.remove('hidden');
  }

  function handleUpdateTemplate() {
    if (isOperating) return;
    var app = backend();
    if (!app) return;
    setOperatingState(true, null, null, true);
    app.UpdateTemplate(t('dialog.updateTitle')).then(function (res) {
      if (!res) return null; // the open dialog was cancelled
      lastUpdate = res;
      renderUpdateResult();
      appendLog('[done] updated ' + res.path + ': ' + res.addedTotal + ' new entries');
      // The file changed, so a report shown for it is out of date.
      if (lastReport && lastReport.path === res.path) {
        return app.CheckLocaleFile(res.path).then(function (report) {
          lastReport = report;
          renderReport();
        }).catch(function () { /* the old report stays; the update itself worked */ });
      }
      return null;
    }).catch(function (err) {
      var msg = errorText(err);
      appendLog('[error] ' + msg);
      showMessage(t('msg.updateFailed'), msg);
    }).then(function () {
      setOperatingState(false);
    });
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  elBtnPrimaryAction.addEventListener('click', handlePrimaryAction);
  elBtnSecondaryAction.addEventListener('click', launchApp);
  elBtnChangePath.addEventListener('click', handleChangePath);
  // The trailing "restore" link and the primary button ask the same question
  // through the same dialog, so there is one wording for a shutdown.
  elBtnRestore.addEventListener('click', function () {
    confirmAction(t('confirm.restoreTitle'), 'restore', function () {
      closeConfirm();
      doRestore();
    });
  });
  elBtnCancelApply.addEventListener('click', closeConfirm);

  elUiLanguage.addEventListener('change', handleUILanguageChange);

  elBtnReapply.addEventListener('click', handleReapply);
  elBtnReapplyLoad.addEventListener('click', handleLoadFile);
  elBtnReapplyDismiss.addEventListener('click', function () {
    reapplyDismissed = true;
    renderReapply();
  });

  elBtnExportTemplate.addEventListener('click', handleExport);
  elBtnLoadFile.addEventListener('click', handleLoadFile);
  elBtnApplyFile.addEventListener('click', handleApplyFile);
  elBtnUpdateTemplate.addEventListener('click', handleUpdateTemplate);

  elBtnAbout.addEventListener('click', function () {
    elAboutModal.classList.remove('hidden');
  });
  elBtnCloseAbout.addEventListener('click', function () {
    elAboutModal.classList.add('hidden');
  });

  elBtnMsgOk.addEventListener('click', function () {
    elMsgModal.classList.add('hidden');
  });

  elBtnToggleLogs.addEventListener('click', function () {
    elLogDrawer.classList.toggle('hidden');
  });
  elBtnCloseLogs.addEventListener('click', function () {
    elLogDrawer.classList.add('hidden');
  });
  elBtnCopyLogs.addEventListener('click', function () {
    var text = operationLogs.join('\n');
    // navigator.clipboard is only exposed in a secure context and can be
    // absent in older WebView2 builds. Wails ships its own clipboard call, so
    // fall back to it instead of leaving the button doing nothing.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showMessage(t('msg.copiedTitle'), t('msg.copied'));
      }).catch(function () {
        copyLogsWithRuntime(text);
      });
      return;
    }
    copyLogsWithRuntime(text);
  });

  function copyLogsWithRuntime(text) {
    var rt = window.runtime;
    if (rt && typeof rt.ClipboardSetText === 'function') {
      try {
        var result = rt.ClipboardSetText(text);
        if (result && typeof result.then === 'function') {
          result.then(function (ok) {
            if (ok === false) {
              showMessage(t('msg.copyFailedTitle'), t('msg.copyFailed'));
            } else {
              showMessage(t('msg.copiedTitle'), t('msg.copied'));
            }
          }).catch(function () {
            showMessage(t('msg.copyFailedTitle'), t('msg.copyFailed'));
          });
          return;
        }
        showMessage(t('msg.copiedTitle'), t('msg.copied'));
        return;
      } catch (err) {
        // Fall through to the manual-selection hint below.
      }
    }
    showMessage(t('msg.copyFailedTitle'), t('msg.copyFailed'));
  }

  function setupWailsEvents() {
    if (window.runtime && window.runtime.EventsOn) {
      window.runtime.EventsOn('progress', function (data) {
        if (!data || !isOperating) return;
        var stage = data.stage || '';
        var detail = data.detail || '';
        // The backend sends English sentences; a translation is looked up by
        // the sentence itself and the sentence is shown when there is none.
        if (stage) progressStage = function () { return tOr('progress.' + stage, stage); };
        if (detail) progressDetail = function () { return detail; };
        renderProgress();
        appendLog('[progress] ' + stage + (detail ? ': ' + detail : ''));
      });
    }
  }

  function loadUIInfo(app) {
    if (!app || !app.GetUIInfo) return Promise.resolve();
    return app.GetUIInfo().then(applyUIInfo).catch(function (err) {
      appendLog('[error] could not load the interface languages: ' + errorText(err));
    });
  }

  window.addEventListener('DOMContentLoaded', function () {
    setupWailsEvents();
    // Wait briefly for the Wails IPC layer to attach window.go.
    setTimeout(function () {
      var app = backend();
      loadUIInfo(app).then(function () {
        renderAll();
        if (app) {
          app.GetVersion().then(function (v) {
            if (v) elAppVersionBadge.textContent = 'v' + v;
          }).catch(function () {});
        }
        return refreshStatus();
      }).then(loadLocales).then(refreshReapplyHint);
    }, 120);
  });
})();
