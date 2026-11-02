/**
 * The AI apps that can connect to Metriq. All of them use the same Metriq connector (one link per
 * key, the same tools, the same rules); only the steps to add it differ.
 * Menus in these apps change often: the steps name the setting to look for, not only the path.
 */

export type ConnectorId = 'claude' | 'chatgpt' | 'gemini' | 'claude-code' | 'cursor' | 'vscode' | 'perplexity' | 'other'

export interface ConnectorStep { text: string; code?: 'link' | 'gemini-cli' | 'cursor' | 'vscode' | 'claude-code' }

export interface ConnectorWay {
  title: string
  /** Who can use this way (plan, account). */
  needs: string
  steps: ConnectorStep[]
}

export interface Connector {
  id: ConnectorId
  name: string
  maker: string
  /** Two letters for the tile (no product logos). */
  mark: string
  /** Coding tools are listed apart, under "For developers". */
  developer?: boolean
  /** Tailwind classes for the tile. */
  tone: string
  tagline: string
  keyName: string
  ways: ConnectorWay[]
  examples: string[]
}

export const CONNECTORS: Connector[] = [
  {
    id: 'claude',
    name: 'Claude',
    maker: 'Anthropic',
    mark: 'Cl',
    tone: 'bg-[#D97757]/15 text-[#B5583A] dark:text-[#E89A7E]',
    tagline: 'Work your leads, tickets and to-dos, from Claude on the web, desktop or phone.',
    keyName: 'My Claude',
    ways: [
      {
        title: 'Claude (web, desktop and phone)',
        needs: 'Any Claude plan that allows custom connectors.',
        steps: [
          { text: 'In Claude, open Settings, then Connectors, then Add custom connector.' },
          { text: 'Name it Metriq and paste your link:', code: 'link' },
          { text: 'Save. In a chat, turn Metriq on from the tools menu if it is not on already.' },
        ],
      },
    ],
    examples: ['Which of my Metriq leads need a follow-up today?', 'Do my Metriq tickets in CMR', 'Work on CMR-6', 'Give Sara a ticket in OPS to update the price list, due Friday'],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    maker: 'OpenAI',
    mark: 'GP',
    tone: 'bg-[#10A37F]/15 text-[#0B7A5F] dark:text-[#4CC9A6]',
    tagline: 'Your leads, tickets, to-dos and team data from a ChatGPT chat.',
    keyName: 'My ChatGPT',
    ways: [
      {
        title: 'ChatGPT on the web',
        needs: 'A paid ChatGPT plan with Developer mode. On a Business or Enterprise workspace an admin may have to allow it first.',
        steps: [
          { text: 'In ChatGPT, open Settings and find Apps (it may be called Apps & Connectors or Plugins). Under Advanced settings, turn on Developer mode.' },
          { text: 'Back in Apps, click Create (or +). Name it Metriq and paste your link as the MCP server URL:', code: 'link' },
          { text: 'For Authentication choose No authentication (No Auth). Tick that you trust it, then Create.' },
          { text: 'In a new chat, click + by the message box, pick Metriq (under More or Developer mode), then ask.' },
        ],
      },
    ],
    examples: ['Which high-priority leads in Metriq should I call first?', 'Show this week\'s e-commerce board from Metriq', 'List my Metriq tickets', 'What is left on CMR-6? Tick the items I finished', 'Move OPS-12 to In review with a comment'],
  },
  {
    id: 'gemini',
    name: 'Gemini',
    maker: 'Google',
    mark: 'Ge',
    tone: 'bg-[#4285F4]/15 text-[#2F6BD8] dark:text-[#8AB4F8]',
    tagline: 'Your leads, tickets and to-dos from Gemini, in the Gemini app or Gemini CLI.',
    keyName: 'My Gemini',
    ways: [
      {
        title: 'Gemini app (gemini.google.com)',
        needs: 'Google is rolling this out: a personal Google account in the US, Gemini in English, Keep Activity on, and Gemini Spark (Google AI Pro or Ultra). If the option is missing or will not add Metriq, use Gemini CLI below.',
        steps: [
          { text: 'On a computer, open gemini.google.com, then Settings, then Connected Apps.' },
          { text: 'Under Custom apps, click Add a custom app and paste your link:', code: 'link' },
          { text: 'Click Next and approve. Then type @ in a chat and pick Metriq, or just ask.' },
        ],
      },
      {
        title: 'Gemini CLI (terminal)',
        needs: 'Gemini CLI installed on your computer.',
        steps: [
          { text: 'Open the file .gemini/settings.json in your home folder (make it if it is not there) and add Metriq:', code: 'gemini-cli' },
          { text: 'Start gemini and type /mcp: Metriq and its tools should be listed. Then ask.' },
        ],
      },
    ],
    examples: ['Who can I call right now in my Metriq Lead Dialer?', 'Show my open Metriq tickets', 'Read CMR-6 and tell me what is needed', 'Comment on OPS-12 that the file is uploaded'],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    maker: 'Perplexity',
    mark: 'Px',
    tone: 'bg-[#20808D]/15 text-[#1A6670] dark:text-[#5FC6D1]',
    tagline: 'Ask about your leads, tickets and team from Perplexity.',
    keyName: 'My Perplexity',
    ways: [
      {
        title: 'Perplexity (web and app)',
        needs: 'A paid Perplexity plan with custom connectors. Perplexity is still rolling this out: if the option is missing, your plan or account does not have it yet.',
        steps: [
          { text: 'In Perplexity, open Settings, then Connectors, and add a custom connector (it may say Add MCP server or Custom).' },
          { text: 'Name it Metriq and paste your link as the server URL:', code: 'link' },
          { text: 'If it asks how to sign in, choose none (the link already holds your key). Save.' },
          { text: 'In a new thread, switch Metriq on under sources or connectors, then ask. Without it on, Perplexity searches the web instead.' },
        ],
      },
    ],
    examples: ['Which Metriq leads came in today and who has them?', 'List my open Metriq tickets', 'What is on my Metriq to-do list today?'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    maker: 'Anthropic',
    mark: 'CC',
    developer: true,
    tone: 'bg-[#D97757]/15 text-[#B5583A] dark:text-[#E89A7E]',
    tagline: 'Work Metriq tickets from the terminal: read the ticket, change the code, comment and move it.',
    keyName: 'My Claude Code',
    ways: [
      {
        title: 'Claude Code (terminal)',
        needs: 'Claude Code installed on your computer.',
        steps: [
          { text: 'In a terminal, run this once (it adds Metriq for every project on this computer):', code: 'claude-code' },
          { text: 'Start claude and type /mcp: Metriq should be listed as connected. Then ask, for example "Do my Metriq tickets in CMR".' },
        ],
      },
    ],
    examples: ['Do my Metriq tickets in CMR', 'Read CMR-6, make the change in this repo, then comment and move it to In review', 'What errors does Metriq System Health show?'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    maker: 'Anysphere',
    mark: 'Cu',
    developer: true,
    tone: 'bg-slate-900/10 text-slate-800 dark:bg-white/10 dark:text-slate-100',
    tagline: 'Your Metriq tickets inside the Cursor editor, for its agent to work on.',
    keyName: 'My Cursor',
    ways: [
      {
        title: 'Cursor',
        needs: 'Cursor on your computer.',
        steps: [
          { text: 'Open Cursor Settings, then MCP (Tools & MCP), then Add new MCP server. Or open the file .cursor/mcp.json in your home folder and add Metriq:', code: 'cursor' },
          { text: 'Save. Metriq shows with a green dot when it is connected. Ask the agent in chat.' },
        ],
      },
    ],
    examples: ['Do my Metriq tickets in CMR', 'Fix the bug in OPS-12 and comment what you changed'],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    maker: 'Microsoft',
    mark: 'VS',
    developer: true,
    tone: 'bg-[#007ACC]/15 text-[#0065A9] dark:text-[#5CB8F0]',
    tagline: 'Metriq tickets in VS Code, for GitHub Copilot in agent mode.',
    keyName: 'My VS Code',
    ways: [
      {
        title: 'VS Code with GitHub Copilot',
        needs: 'VS Code with GitHub Copilot (agent mode). On a company Copilot plan an admin may have to allow MCP servers.',
        steps: [
          { text: 'In your project, make the file .vscode/mcp.json (or run "MCP: Add Server" from the command palette, choose HTTP) and add Metriq:', code: 'vscode' },
          { text: 'Click Start above the Metriq line in the file. In Copilot Chat, pick Agent mode; Metriq\'s tools are under the tools button.' },
          { text: 'Do not commit this file: the link holds your key. Add .vscode/mcp.json to .gitignore.' },
        ],
      },
    ],
    examples: ['Do my Metriq tickets in CMR', 'Read CMR-6 and make the change'],
  },
  {
    id: 'other',
    name: 'Any other AI app',
    maker: 'MCP',
    mark: '+',
    tone: 'bg-primary/10 text-primary',
    tagline: 'Any app or tool that can add a remote MCP server (connector) by its address.',
    keyName: 'My AI app',
    ways: [
      {
        title: 'Any app that takes an MCP server address',
        needs: 'Look in the app\'s settings for Connectors, Integrations, Tools or MCP servers. It must take a remote (HTTP) address; Metriq needs no sign-in beyond the link.',
        steps: [
          { text: 'Add a new server or connector of type HTTP (it may say Streamable HTTP or Remote). Name it Metriq and paste your link:', code: 'link' },
          { text: 'Leave sign-in (authentication) off. Save, switch it on, then ask about your Metriq work.' },
        ],
      },
    ],
    examples: ['What is on my Metriq to-do list today?', 'List my Metriq leads that are late'],
  },
]

export const connectorById = (id: string | undefined) => CONNECTORS.find((c) => c.id === id) ?? null

/** What every connector can do (the Metriq tools), in plain words. */
export const CAPABILITIES: { group: string; items: string[]; healthOnly?: boolean }[] = [
  { group: 'Leads', items: ['List the leads you can see: new, late, not assigned, by business', 'Open a lead with its full history', 'Log a call or email, add a note, change the status', 'Managers: give a lead to a rep; add a phone lead'] },
  { group: 'To-dos and meetings', items: ['Your to-dos for a day, week or month; add and tick them off', 'Your meetings; schedule one and invite people by name'] },
  { group: 'Your team\'s data', items: ['ITAD: Lead Dialer follow-ups, who to call now, hot leads, any lead in full', 'ITAD: log a note, call back or snooze on a lead', 'Daily logs, deals, the e-commerce board and stock, Lead Gen and Marketing numbers', 'Your attendance, to-dos, meetings and work log; team leads also their team'] },
  { group: 'Your tickets', items: ['List the tickets given to you', 'Read a ticket with its checklist, comments and files', 'Comment on a ticket', 'Move a ticket to another column', 'Tick checklist items, or add new ones'] },
  { group: 'Giving work', items: ['Make a ticket and give it to someone in the project', 'Change a ticket: title, description, assignee, due date, priority', 'Delete a ticket you made'] },
  { group: 'Projects', items: ['List your projects, their columns and members', 'List the tickets on a project board'] },
  { group: 'System Health', items: ['See errors and the hourly self check', 'Run the self check, mark errors fixed'], healthOnly: true },
]

export function geminiCliConfig(link: string): string {
  return JSON.stringify({ mcpServers: { metriq: { httpUrl: link } } }, null, 2)
}

export function cursorConfig(link: string): string {
  return JSON.stringify({ mcpServers: { metriq: { url: link } } }, null, 2)
}

export function vscodeConfig(link: string): string {
  return JSON.stringify({ servers: { metriq: { type: 'http', url: link } } }, null, 2)
}

export function claudeCodeCommand(link: string): string {
  return `claude mcp add --transport http --scope user metriq ${link}`
}
