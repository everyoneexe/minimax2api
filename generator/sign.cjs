const crypto = require('crypto');

const StorageMock = {
  store: {
    'mvs_uuid': '6cafb2f8-5868-4755-a50b-c54f9a7edc4a',
    'mvs_device_id': '62532107',
    'mvs_user_config': '{}',
    'mvs_token': '',
  },
  getItem(key) { return this.store[key] || null; },
  setItem(key, val) { this.store[key] = String(val); },
};

function md5(data) {
  return crypto.createHash('md5').update(data, 'utf8').digest('hex');
}

function buildDeviceParams(tsMs, isSmsSend = false) {
  const userConfig = JSON.parse(StorageMock.getItem('mvs_user_config') || '{}');
  const params = {
    device_platform: 'web', biz_id: 3, app_id: '3001', version_code: '22201',
    unix: tsMs, timezone_offset: 10800, sys_language: 'en', lang: 'en',
    uuid: StorageMock.getItem('mvs_uuid') || '',
    device_id: StorageMock.getItem('mvs_device_id') || '62532107',
    os_name: 'Linux', browser_name: 'Firefox', device_memory: 8, cpu_core_num: 16,
    browser_language: 'en-US', browser_platform: 'Linux x86_64',
    user_id: userConfig.realUserID || 0,
    op_ticket: userConfig.op_ticket,
    screen_width: 1920, screen_height: 1080,
    token: userConfig.token || StorageMock.getItem('mvs_token') || ''
  };
  if (isSmsSend) { delete params.token; delete params.user_id; delete params.op_ticket; }
  return params;
}

function serializeUrl(path, params) {
  const searchParams = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== '') {
      searchParams.append(key, val);
    }
  }
  const qs = searchParams.toString();
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

function calculateYY(pathAndQuery, body, tsMs, method = 'POST') {
  let yyBody = '{}';
  if (method.toUpperCase() === 'POST') {
    yyBody = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '{}';
  }
  const encodedPath = encodeURIComponent(pathAndQuery);
  const timeMd5 = md5(String(tsMs));
  return md5(`${encodedPath}_${yyBody}${timeMd5}ooui`);
}

function calculateXSignature(tsS, body) {
  const SECRET = 'I*7Cf%WZ#S&%1RlZJ&C2';
  const bodyStr = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : '';
  return md5(`${tsS}${SECRET}${bodyStr}`);
}

// Main
const args = JSON.parse(process.argv[2]);
const {jwt, uid, device_id, path, body: bodyArg, method} = args;

StorageMock.store['mvs_user_config'] = JSON.stringify({realUserID: uid, token: jwt});
if (device_id) StorageMock.store['mvs_device_id'] = device_id;
StorageMock.store['mvs_token'] = jwt;

const tsMs = Date.parse(new Date().toString());
const tsS = Math.floor(tsMs / 1000);
const body = bodyArg || JSON.stringify({model: 'minimax/MiniMax-M3'});
const params = buildDeviceParams(tsMs);
const pathAndQuery = serializeUrl(path || '/archon/api/v1/agent/404574372720710/session', {...params, client:'web', region:'en'});
const yy = calculateYY(pathAndQuery, body, tsMs, method || 'POST');
const sig = calculateXSignature(tsS, body);

console.log(JSON.stringify({yy, sig, ts_s: tsS, path_qs: pathAndQuery, body, jwt, uid}));
