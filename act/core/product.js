// product.js — v1.0.0 · the product name the kernel writes where others can see it · changelog: act/CHANGELOG.md#actcoreproductjs
// Copyright (c) 2026 John Koperwas. SPDX-License-Identifier: Apache-2.0
// (C) John Koperwas 2026 · Koperwas Systems
// The product name the kernel writes where others can see it: the fetch User-Agent (<name>-fetch/1.0), the mail footer
// ("Sent by <name> for …"), the X-Mailer header, and the message of a paused script daemon. A host passes its own name to
// create({ productName }); without one the kernel calls itself ACTBUS (DEFAULT, the only place that name is written).
// The name goes into headers, so it must be a plain token: 1–32 letters, digits, dots, dashes or underscores, starting with a
// letter or a digit. Anything else (a space, a line break, an empty string, a non-string) is refused when the kernel starts.
'use strict';
const DEFAULT = 'ACTBUS';
const SHAPE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
function productName(v) {
  if (v === undefined) return DEFAULT;
  if (typeof v !== 'string' || !SHAPE.test(v)) throw new Error('productName must be 1–32 letters, digits, dots, dashes or underscores, starting with a letter or a digit (got ' + JSON.stringify(typeof v === 'string' ? v : String(v)).slice(0, 40) + ')');
  return v;
}
module.exports = { DEFAULT, productName };
