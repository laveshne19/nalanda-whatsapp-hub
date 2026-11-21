'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { render } = require('../src/templates-doc');
const file = path.join(__dirname, '..', 'docs', 'TEMPLATES.md');
fs.writeFileSync(file, render());
console.log('wrote', file);
