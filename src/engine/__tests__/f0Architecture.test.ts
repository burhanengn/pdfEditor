import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dictionaries } from '@/i18n/dictionaries';
import { translate } from '@/i18n/useI18n';

describe('F0 i18n, branding, and typography token gates', () => {
  it('provides full EN/TR translation parity without missing keys', () => {
    const enKeys = Object.keys(dictionaries.en).sort();
    const trKeys = Object.keys(dictionaries.tr).sort();
    expect(trKeys).toEqual(enKeys);
    expect(translate('en', 'action.editPdf')).toBe('Edit');
    expect(translate('tr', 'action.editPdf')).toBe('Düzenle');
    expect(translate('en', 'app.name')).toBe('gullacpdf');
  });

  it('enforces gullacpdf brand name across package.json, README, and index.html', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    const readme = fs.readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');

    expect(pkg.name).toBe('gullacpdf');
    expect(readme).toContain('gullacpdf');
    expect(readme).not.toContain('AetherPDF');
    expect(html).toContain('gullacpdf');
  });

  it('has zero sub-12px Tailwind text classes across src/', () => {
    const srcRoot = path.resolve(process.cwd(), 'src');
    const violations: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const content = fs.readFileSync(full, 'utf8');
          if (/text-\[(?:9|10|11)px\]/.test(content)) {
            violations.push(full);
          }
        }
      }
    };
    walk(srcRoot);
    expect(violations).toEqual([]);
  });
});
