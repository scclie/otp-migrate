(function () {
  'use strict';

  var ALGO_MAP = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' };

  // ── protobuf ────────────────────────────────────────────────
  function decodeVarint(data, pos) {
    var result = 0, shift = 0;
    while (pos < data.length) {
      var byte = data[pos];
      result |= (byte & 0x7f) << shift;
      pos++;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return [result, pos];
  }

  function parseMessage(data) {
    var fields = {}, i = 0;
    while (i < data.length) {
      var tag, wire;
      [tag, i] = decodeVarint(data, i);
      var fieldNum = tag >> 3;
      wire = tag & 0x7;

      if (wire === 0) {
        var v;
        [v, i] = decodeVarint(data, i);
        (fields[fieldNum] || (fields[fieldNum] = [])).push(['varint', v]);
      } else if (wire === 2) {
        var len;
        [len, i] = decodeVarint(data, i);
        var slice = data.slice(i, i + len);
        i += len;
        (fields[fieldNum] || (fields[fieldNum] = [])).push(['bytes', slice]);
      } else if (wire === 5) {
        i += 4;
      } else if (wire === 1) {
        i += 8;
      } else {
        break;
      }
    }
    return fields;
  }

  function base32Encode(bytes) {
    var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    var bits = '';
    for (var i = 0; i < bytes.length; i++) {
      bits += bytes[i].toString(2).padStart(8, '0');
    }
    while (bits.length % 5 !== 0) bits += '0';
    var out = '';
    for (var j = 0; j < bits.length; j += 5) {
      out += alphabet[parseInt(bits.slice(j, j + 5), 2)];
    }
    return out;
  }

  function decodeMigration(url) {
    var data = url;
    if (url.indexOf('data=') !== -1) data = url.split('data=', 2)[1];
    data = decodeURIComponent(data);
    data = data.replace(/-/g, '+').replace(/_/g, '/');
    var pad = 4 - (data.length % 4);
    if (pad !== 4) data += '='.repeat(pad);

    var raw = Uint8Array.from(atob(data), function (c) { return c.charCodeAt(0); });
    var top = parseMessage(raw);
    var accounts = [];

    (top[1] || []).forEach(function (entry) {
      if (entry[0] !== 'bytes') return;
      var acct = parseMessage(entry[1]);

      var secretBytes = null;
      if (acct[1]) secretBytes = acct[1][0][1];

      var name = '';
      if (acct[2]) name = new TextDecoder().decode(acct[2][0][1]);

      var issuer = '';
      if (acct[3]) issuer = new TextDecoder().decode(acct[3][0][1]);

      var algorithm = 'SHA1';
      if (acct[4]) algorithm = ALGO_MAP[acct[4][0][1]] || 'SHA1';

      var digits = 6;
      if (acct[5]) digits = acct[5][0][1];

      var otpType = 'TOTP';
      if (acct[6]) otpType = acct[6][0][1] === 1 ? 'TOTP' : 'HOTP';

      if (secretBytes) {
        accounts.push({
          name: name,
          issuer: issuer,
          secret: base32Encode(secretBytes),
          algorithm: algorithm,
          digits: digits,
          type: otpType
        });
      }
    });

    return accounts;
  }

  // ── QR scan ─────────────────────────────────────────────────
  function scanImage(img) {
    var canvas = document.getElementById('qr-canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
    return code ? code.data : null;
  }

  // ── QR generate ─────────────────────────────────────────────
  function generateQR(text, size) {
    var qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    var svg = qr.createSvgTag(size || 4, 0);
    return svg;
  }

  // ── UI ──────────────────────────────────────────────────────
  var elDropZone = document.getElementById('drop-zone');
  var elFileInput = document.getElementById('file-input');
  var elUrlInput = document.getElementById('url-input');
  var elError = document.getElementById('error');
  var elResult = document.getElementById('result');
  var elResultCount = document.getElementById('result-count');
  var elAccounts = document.getElementById('accounts');
  var elBtnCopyAll = document.getElementById('btn-copy-all');

  function showError(msg) {
    elError.style.display = 'block';
    elError.querySelector('.error-msg').textContent = msg;
  }

  function hideError() {
    elError.style.display = 'none';
  }

  function processUrl(url) {
    hideError();
    if (url.indexOf('otpauth-migration://') === -1) {
      showError('not a valid migration URL. expected otpauth-migration://offline?data=...');
      return;
    }
    try {
      var accounts = decodeMigration(url);
      if (accounts.length === 0) {
        showError('no accounts found in migration data');
        return;
      }
      renderAccounts(accounts);
    } catch (e) {
      showError('failed to decode: ' + e.message);
    }
  }

  function processImage(img) {
    var text = scanImage(img);
    if (!text) {
      showError('no QR code found in image');
      return;
    }
    if (text.indexOf('otpauth-migration://') === -1) {
      showError('QR code does not contain migration data (got: ' + text.slice(0, 60) + '...)');
      return;
    }
    elUrlInput.value = text;
    processUrl(text);
  }

  function renderAccounts(accounts) {
    elResult.style.display = 'block';
    elResultCount.textContent = accounts.length + ' account' + (accounts.length !== 1 ? 's' : '') + ' found';
    elAccounts.innerHTML = '';

    accounts.forEach(function (acc, idx) {
      var label = acc.issuer ? acc.issuer + ':' + acc.name : acc.name;
      var uri = 'otpauth://totp/' + encodeURIComponent(label) +
        '?secret=' + acc.secret +
        '&issuer=' + encodeURIComponent(acc.issuer) +
        '&algorithm=' + acc.algorithm +
        '&digits=' + acc.digits;

      var card = document.createElement('div');
      card.className = 'account-card';
      card.innerHTML =
        '<div class="account-header">' +
          '<span class="account-issuer">' + esc(acc.issuer || 'unknown') + '</span>' +
          '<span class="account-name">' + esc(acc.name) + '</span>' +
        '</div>' +
        '<div class="account-meta">' +
          '<span class="tag">' + acc.type + '</span>' +
          '<span class="tag">' + acc.algorithm + '</span>' +
          '<span class="tag">' + acc.digits + ' digits</span>' +
        '</div>' +
        '<div class="account-field">' +
          '<span class="account-label">secret</span>' +
          '<div class="account-secret">' +
            '<code id="secret-' + idx + '">' + esc(acc.secret) + '</code>' +
            '<button class="btn btn-small copy-btn" data-target="secret-' + idx + '">copy</button>' +
          '</div>' +
        '</div>' +
        '<div class="account-field">' +
          '<span class="account-label">otpauth uri</span>' +
          '<div class="account-uri" id="uri-' + idx + '">' + esc(uri) + '</div>' +
        '</div>' +
        '<div class="account-actions">' +
          '<button class="btn btn-small copy-uri" data-uri="' + esc(uri) + '">copy uri</button>' +
          '<button class="btn btn-small toggle-qr" data-idx="' + idx + '">show qr</button>' +
        '</div>' +
        '<div class="account-qr" id="qr-' + idx + '" style="display:none"></div>';

      elAccounts.appendChild(card);

      var qrContainer = card.querySelector('#qr-' + idx);
      var toggleBtn = card.querySelector('.toggle-qr');
      toggleBtn.addEventListener('click', function () {
        if (qrContainer.style.display === 'none') {
          qrContainer.style.display = 'block';
          if (!qrContainer.innerHTML) qrContainer.innerHTML = generateQR(uri, 6);
          toggleBtn.textContent = 'hide qr';
        } else {
          qrContainer.style.display = 'none';
          toggleBtn.textContent = 'show qr';
        }
      });
    });

    elAccounts.querySelectorAll('.copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var target = document.getElementById(btn.dataset.target);
        copyText(target.textContent, btn);
      });
    });

    elAccounts.querySelectorAll('.copy-uri').forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyText(btn.dataset.uri, btn);
      });
    });
  }

  function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(function () {
      var orig = btn.textContent;
      btn.textContent = 'copied!';
      btn.classList.add('copy-ok');
      setTimeout(function () {
        btn.textContent = orig;
        btn.classList.remove('copy-ok');
      }, 1500);
    });
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── events ──────────────────────────────────────────────────
  elDropZone.addEventListener('click', function () { elFileInput.click(); });

  elDropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    elDropZone.classList.add('drag-over');
  });
  elDropZone.addEventListener('dragleave', function () {
    elDropZone.classList.remove('drag-over');
  });
  elDropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    elDropZone.classList.remove('drag-over');
    var file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadFile(file);
  });

  elFileInput.addEventListener('change', function () {
    if (elFileInput.files[0]) loadFile(elFileInput.files[0]);
  });

  document.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (items) {
      for (var i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          loadFile(items[i].getAsFile());
          return;
        }
      }
    }
    var text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && text.indexOf('otpauth-migration://') !== -1) {
      elUrlInput.value = text;
      processUrl(text);
    }
  });

  elUrlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') processUrl(elUrlInput.value.trim());
  });

  elBtnCopyAll.addEventListener('click', function () {
    var secrets = [];
    elAccounts.querySelectorAll('code').forEach(function (c) { secrets.push(c.textContent); });
    copyText(secrets.join('\n'), elBtnCopyAll);
  });

  function loadFile(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () { processImage(img); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // auto-decode if URL has hash with migration data
  if (location.hash && location.hash.indexOf('otpauth-migration') !== -1) {
    elUrlInput.value = decodeURIComponent(location.hash.slice(1));
    processUrl(elUrlInput.value);
  }
})();
