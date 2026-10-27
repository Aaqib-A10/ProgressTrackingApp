/**
 * The AI apps that can connect to Metriq. All three use the same Metriq connector (one link per
 * key, the same tools, the same rules); only the steps to add it differ.
 * Menus in these apps change often: the steps name the setting to look for, not only the path.
 */

export type ConnectorId = 'claude' | 'chatgpt' | 'gemini'

export interface ConnectorStep { text: string; code?: 'link' | 'gemini-cli' }

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
    tagline: 'Do your tickets, comment, move cards and give work, from Claude on the web, desktop or phone.',
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
    tagline: 'Read and update your Metriq tickets from a ChatGPT chat.',
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
    tagline: 'Use your Metriq tickets from Gemini, in the Gemini app or Gemini CLI.',
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
]

export const connectorById = (id: string | undefined) => CONNECTORS.find((c) => c.id === id) ?? null

/** What every connector can do (the Metriq tools), in plain words. */
export const CAPABILITIES: { group: string; items: string[]; healthOnly?: boolean }[] = [
  { group: 'Your team\'s data', items: ['ITAD: Lead Dialer follow-ups, who to call now, hot leads, any lead in full', 'ITAD: log a note, call back or snooze on a lead', 'Daily logs, deals, the e-commerce board and stock, Lead Gen and Marketing numbers', 'Your attendance, to-dos, meetings and work log; team leads also their team'] },
  { group: 'Your tickets', items: ['List the tickets given to you', 'Read a ticket with its checklist, comments and files', 'Comment on a ticket', 'Move a ticket to another column', 'Tick checklist items, or add new ones'] },
  { group: 'Giving work', items: ['Make a ticket and give it to someone in the project', 'Change a ticket: title, description, assignee, due date, priority', 'Delete a ticket you made'] },
  { group: 'Projects', items: ['List your projects, their columns and members', 'List the tickets on a project board'] },
  { group: 'System Health', items: ['See errors and the hourly self check', 'Run the self check, mark errors fixed'], healthOnly: true },
]

export function geminiCliConfig(link: string): string {
  return JSON.stringify({ mcpServers: { metriq: { httpUrl: link } } }, null, 2)
}
