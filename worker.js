const WEB3FORMS_URL = 'https://api.web3forms.com/submit';
const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const MAX_REQUEST_BYTES = 16_384;
const MAX_MESSAGE_LENGTH = 10_000;

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

function isString(value) {
  return typeof value === 'string';
}

async function handleContact(request, env) {
  if (request.method !== 'POST') {
    return jsonResponse(
      { success: false, message: 'Method not allowed.' },
      405,
      { Allow: 'POST' }
    );
  }

  const origin = request.headers.get('Origin');
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) {
        return jsonResponse({ success: false, message: 'Request origin is not allowed.' }, 403);
      }
    } catch {
      return jsonResponse({ success: false, message: 'Request origin is not allowed.' }, 403);
    }
  }

  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    return jsonResponse({ success: false, message: 'Expected a JSON request.' }, 415);
  }

  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ success: false, message: 'The submitted message is too large.' }, 413);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return jsonResponse({ success: false, message: 'The request could not be read.' }, 400);
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return jsonResponse({ success: false, message: 'The request could not be read.' }, 400);
  }

  if (isString(data.website) && data.website.trim()) {
    return jsonResponse({ success: true, message: 'Your inquiry has been sent. Thank you.' });
  }

  const fullName = isString(data.fullName) ? data.fullName.trim() : '';
  const subject = isString(data.subject) ? data.subject.replace(/[\r\n]+/g, ' ').trim() : '';
  const email = isString(data.email) ? data.email.trim() : '';
  const company = isString(data.company) ? data.company.trim() : '';
  const mobile = isString(data.mobile) ? data.mobile.trim() : '';
  const message = isString(data.message) ? data.message.trim() : '';
  const recaptchaToken = isString(data.recaptchaToken) ? data.recaptchaToken.trim() : '';

  if (
    !fullName || fullName.length > 150 ||
    !subject || subject.length > 200 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    !message || message.length > MAX_MESSAGE_LENGTH ||
    company.length > 200 || mobile.length > 80
  ) {
    return jsonResponse({ success: false, message: 'Please check the submitted contact details.' }, 400);
  }

  if (!env.WEB3FORMS_ACCESS_KEY || !env.RECAPTCHA_SECRET_KEY) {
    return jsonResponse(
      { success: false, message: 'The contact form is temporarily unavailable.' },
      503
    );
  }

  if (!recaptchaToken || recaptchaToken.length > 8192) {
    return jsonResponse(
      { success: false, message: 'The security check expired. Please try again.' },
      400
    );
  }

  const verifyBody = new URLSearchParams({
    secret: env.RECAPTCHA_SECRET_KEY,
    response: recaptchaToken
  });

  let captchaResult;
  try {
    const captchaResponse = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: verifyBody
    });

    if (!captchaResponse.ok) {
      return jsonResponse(
        { success: false, message: 'The security check is temporarily unavailable. Please try again.' },
        502
      );
    }

    captchaResult = await captchaResponse.json();
  } catch {
    return jsonResponse(
      { success: false, message: 'The security check is temporarily unavailable. Please try again.' },
      502
    );
  }

  if (
    !captchaResult ||
    typeof captchaResult !== 'object' ||
    captchaResult.success !== true ||
    captchaResult.action !== 'contact' ||
    typeof captchaResult.score !== 'number' ||
    captchaResult.score < 0.5 ||
    captchaResult.hostname !== new URL(request.url).hostname
  ) {
    return jsonResponse(
      { success: false, message: 'The security check failed. Please try again.' },
      400
    );
  }

  const web3formsPayload = {
    access_key: env.WEB3FORMS_ACCESS_KEY,
    name: fullName,
    email,
    subject: `[EAlegro.com] Contact Form + ${subject}`,
    from_name: 'EAlegro.com Contact Form',
    replyto: email,
    company: company || 'Not provided',
    mobile: mobile || 'Not provided',
    message,
    botcheck: ''
  };

  let web3formsResult;
  try {
    const web3formsResponse = await fetch(WEB3FORMS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: new URL(request.url).origin,
        Referer: `${new URL(request.url).origin}/contact.html`
      },
      body: JSON.stringify(web3formsPayload)
    });

    if (!web3formsResponse.ok) {
      return jsonResponse(
        { success: false, message: 'Your inquiry could not be delivered. Please try again later.' },
        502
      );
    }

    web3formsResult = await web3formsResponse.json();
  } catch {
    return jsonResponse(
      { success: false, message: 'Your inquiry could not be delivered. Please try again later.' },
      502
    );
  }

  if (!web3formsResult || typeof web3formsResult !== 'object' || web3formsResult.success !== true) {
    return jsonResponse(
      { success: false, message: 'Your inquiry could not be delivered. Please try again later.' },
      502
    );
  }

  return jsonResponse({ success: true, message: 'Your inquiry has been sent. Thank you.' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};
