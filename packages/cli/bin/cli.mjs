#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');
const CLAUDE_DIR = join(homedir(), '.claude');
const COMMANDS_DIR = join(CLAUDE_DIR, 'commands');

const REMOTE_URL = 'https://pallas-mcp-server.azurewebsites.net/sse';

const TOOL_PERMISSIONS = [
  'mcp__athena-tools__athena_search_kb',
  'mcp__athena-tools__athena_explain_view',
  'mcp__athena-tools__athena_explain_join',
  'mcp__athena-tools__athena_diagnose_error',
  'mcp__athena-tools__athena_explain_workflow',
  'mcp__athena-tools__athena_suggest_workflow',
  'mcp__athena-tools__athena_submit_feedback',
  'mcp__athena-tools__athena_list_candidates',
  'mcp__athena-tools__athena_review_candidate',
  'mcp__athena-tools__athena_report_safety_flag',
  'mcp__athena-tools__athena_report_outcome',
  'mcp__athena-tools__athena_command_start',
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const command = process.argv[2];

if (command === 'setup') {
  setup();
} else if (command === 'uninstall') {
  uninstall();
} else if (command === 'status') {
  status();
} else {
  console.log(`
  athena-tools — athenahealth integration tools for Claude Code

  Usage:
    athena-tools setup       Install MCP server, slash commands, and CLAUDE.md
    athena-tools uninstall   Remove athena-tools configuration
    athena-tools status      Check installation status

  Quick start (no install needed):
    Add this to your project's .claude/settings.json:
    {
      "mcpServers": {
        "athena-tools": { "url": "${REMOTE_URL}" }
      }
    }
  `);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setup() {
  console.log('\n  athena-tools setup\n  ==================\n');

  // 1. Ensure ~/.claude directories exist
  mkdirSync(COMMANDS_DIR, { recursive: true });
  console.log('  [1/4] ~/.claude/commands/ ready');

  // 2. Install slash commands
  const commandsSource = join(ASSETS, 'commands');
  if (existsSync(commandsSource)) {
    const files = readdirSync(commandsSource).filter(f => f.endsWith('.md'));
    for (const file of files) {
      copyFileSync(join(commandsSource, file), join(COMMANDS_DIR, file));
    }
    console.log(`  [2/4] Installed ${files.length} slash commands to ~/.claude/commands/`);
    files.forEach(f => console.log(`         /` + f.replace('.md', '')));
  } else {
    console.log('  [2/4] No commands to install (assets/commands/ not found)');
  }

  // 3. Configure MCP server in ~/.claude/settings.json
  const settingsPath = join(CLAUDE_DIR, 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    } catch {
      console.log('  [warn] Could not parse existing settings.json — creating new one');
    }
  }

  if (!settings.mcpServers) settings.mcpServers = {};
  settings.mcpServers['athena-tools'] = { url: REMOTE_URL };

  if (!settings.permissions) settings.permissions = {};
  if (!settings.permissions.allow) settings.permissions.allow = [];
  for (const perm of TOOL_PERMISSIONS) {
    if (!settings.permissions.allow.includes(perm)) {
      settings.permissions.allow.push(perm);
    }
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('  [3/4] MCP server configured (remote: pallas-mcp-server.azurewebsites.net)');

  // 4. Install CLAUDE.md guidance
  const claudeMdSource = join(ASSETS, 'CLAUDE.md');
  const claudeMdDest = join(CLAUDE_DIR, 'CLAUDE.md');
  if (existsSync(claudeMdSource)) {
    if (existsSync(claudeMdDest)) {
      // Append rather than overwrite existing CLAUDE.md
      const existing = readFileSync(claudeMdDest, 'utf-8');
      if (!existing.includes('athenahealth Integration Engineer')) {
        const athenaContent = readFileSync(claudeMdSource, 'utf-8');
        writeFileSync(claudeMdDest, existing + '\n\n' + athenaContent);
        console.log('  [4/4] Appended athenahealth guidance to existing ~/.claude/CLAUDE.md');
      } else {
        console.log('  [4/4] CLAUDE.md already contains athenahealth guidance (skipped)');
      }
    } else {
      copyFileSync(claudeMdSource, claudeMdDest);
      console.log('  [4/4] Installed CLAUDE.md to ~/.claude/');
    }
  } else {
    console.log('  [4/4] No CLAUDE.md to install');
  }

  console.log(`
  Done! Open Claude Code in any project and you now have:
  - 9 athenahealth MCP tools (search, explain, diagnose, feedback, review)
  - 9 slash commands (/sql, /athena-api, /onboard, /diagnose, etc.)
  - Proactive safety rules for DataView and API development
  - Learning loop that gets smarter from every interaction

  Try it:  claude
           /onboard I'm building a DataView report
  `);
}

// ---------------------------------------------------------------------------
// Uninstall
// ---------------------------------------------------------------------------

function uninstall() {
  console.log('\n  athena-tools uninstall\n');

  // Remove slash commands
  if (existsSync(COMMANDS_DIR)) {
    const athenaCommands = [
      'athena-api.md', 'diagnose.md', 'explain.md', 'onboard.md',
      'review-athena.md', 'review-candidates.md', 'sql.md', 'validate.md', 'workflow.md'
    ];
    let removed = 0;
    for (const file of athenaCommands) {
      const path = join(COMMANDS_DIR, file);
      if (existsSync(path)) {
        unlinkSync(path);
        removed++;
      }
    }
    console.log(`  Removed ${removed} slash commands`);
  }

  // Remove MCP server from settings
  const settingsPath = join(CLAUDE_DIR, 'settings.json');
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      if (settings.mcpServers?.['athena-tools']) {
        delete settings.mcpServers['athena-tools'];
        // Remove permissions
        if (settings.permissions?.allow) {
          settings.permissions.allow = settings.permissions.allow.filter(
            p => !p.startsWith('mcp__athena-tools__')
          );
        }
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log('  Removed MCP server config from settings.json');
      }
    } catch {
      console.log('  Could not update settings.json');
    }
  }

  console.log('  Done. athena-tools has been removed.\n');
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function status() {
  console.log('\n  athena-tools status\n');

  const settingsPath = join(CLAUDE_DIR, 'settings.json');
  let mcpConfigured = false;
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      mcpConfigured = !!settings.mcpServers?.['athena-tools'];
    } catch { /* ignore */ }
  }

  const commandFiles = existsSync(COMMANDS_DIR)
    ? readdirSync(COMMANDS_DIR).filter(f => ['sql.md', 'onboard.md', 'diagnose.md', 'athena-api.md'].includes(f))
    : [];

  const claudeMd = existsSync(join(CLAUDE_DIR, 'CLAUDE.md'))
    ? readFileSync(join(CLAUDE_DIR, 'CLAUDE.md'), 'utf-8').includes('athenahealth')
    : false;

  console.log(`  MCP Server:     ${mcpConfigured ? 'configured' : 'not configured'}`);
  console.log(`  Slash Commands: ${commandFiles.length > 0 ? commandFiles.length + ' installed' : 'not installed'}`);
  console.log(`  CLAUDE.md:      ${claudeMd ? 'installed' : 'not installed'}`);
  console.log(`  Remote Server:  ${REMOTE_URL}`);
  console.log();

  if (!mcpConfigured) {
    console.log('  Run "athena-tools setup" to install.\n');
  } else {
    console.log('  Everything looks good. Open Claude Code to start.\n');
  }
}
