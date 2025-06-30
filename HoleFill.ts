#!/usr/bin/env bun

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as process from 'process';
import { GenAI, MODELS, tokenCount, AskOptions } from './GenAI';

const SYSTEM = `You're a code completion assistant.`;
const FILL   = '{:FILL_HERE:}';
const TASK =
  `### TASK: complete the ${FILL} part of the file above. ` +
  `Write ONLY the needed text to replace ${FILL} by the correct completion, including correct spacing and indentation. ` +
  `Include the answer inside a <COMPLETION></COMPLETION> tag.`;

/* ------------------------------------------------------------------
 * Utility: force every ".?." placeholder to column-0
 * ------------------------------------------------------------------ */
function leftAlignHoles(code: string): string {
  /* strip any leading spaces or tabs that precede ".?." */
  return code.replace(/^([ \t]+)(\.\?\.)/gm, '$2');
}

async function main(): Promise<void> {
  const file  = process.argv[2];
  const mini  = process.argv[3];
  const model = process.argv[4] || 'c';

  if (!file) {
    console.log('Usage: holefill <file> [<shortened_file>] [<model_name>]');
    console.log('\nThis will complete a HOLE, written as ".?.", in <file>, using the AI.');
    process.exit(1);
  }

  const ai = await GenAI(model);

  /* read user files */
  let file_code = await fs.readFile(file, 'utf-8');
  let mini_code = mini ? await fs.readFile(mini, 'utf-8') : file_code;

  /* expand inline import markers in mini_code */
  const expanded: string[] = [];
  for (const line of mini_code.split('\n')) {
    const m1 = line.match(/^\/\/\.\/(.*?)\/\/$/);
    const m2 = line.match(/^{-\.\/(.*?)-\}$/);
    const m3 = line.match(/^#\.\/(.*?)#$/);
    const m  = m1 || m2 || m3;
    if (m) {
      const p = path.resolve(path.dirname(file), m[1]);
      try { expanded.push(await fs.readFile(p, 'utf-8')); }
      catch { console.log('import_file:', line, 'ERROR'); process.exit(1); }
    } else {
      expanded.push(line);
    }
  }
  mini_code = expanded.join('\n');

  /* --------------------------------------------------------------
   *  New behaviour: NO hole may start after column-0.
   *  We left-align every ".?." in BOTH file_code and mini_code.
   * -------------------------------------------------------------- */
  file_code = leftAlignHoles(file_code);
  mini_code = leftAlignHoles(mini_code);

  if (mini) await fs.writeFile(mini, mini_code, 'utf-8');

  /* build prompt */
  const tokens = tokenCount(mini_code);
  const source = mini_code.replace('.?.', FILL);
  const prompt = `${source}\n\n${TASK}`;

  await fs.mkdir(path.join(os.homedir(), '.ai'), { recursive: true });
  await fs.writeFile(path.join(os.homedir(), '.ai', '.holefill'),
                     `${SYSTEM}\n###\n${prompt}`, 'utf-8');

  console.log('token_count:', tokens);
  console.log('model_label:', MODELS[model] || model);

  if (!mini_code.includes('.?.')) { console.log('No hole found.'); process.exit(1); }

  const replyRaw = await ai.ask(prompt, { system: SYSTEM } as AskOptions);
  const replyStr = typeof replyRaw === 'string'
                   ? replyRaw
                   : replyRaw.messages.map((m: any) => m.content).join('\n');

  const wrapped  = replyStr.includes('<COMPLETION>') ? replyStr : `<COMPLETION>${replyStr}</COMPLETION>`;
  const match    = /<COMPLETION>([\s\S]*?)<\/COMPLETION>/g.exec(wrapped);
  if (!match) { console.error('Error: no <COMPLETION> in AI response.'); process.exit(1); }

  const fill = match[1].replace(/\$/g, '$$$$').replace(/^\n+|\n+$/g, '');
  file_code  = file_code.replace('.?.', fill);

  await fs.writeFile(file, file_code, 'utf-8');

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const logDir = path.join(os.homedir(), '.ai', 'prompt_history');
  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(path.join(logDir, `${ts}_${MODELS[model] || model}.log`),
                     `SYSTEM:\n${SYSTEM}\n\nPROMPT:\n${prompt}\n\nREPLY:\n${wrapped}\n\n`, 'utf-8');
}

main().catch(console.error);
