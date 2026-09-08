/**
 * 站点身份信息集中一处。上线前只需改这个文件。
 */

/** 待填：用户已有域名但尚未提供。改这一行即可，RSS 与 sitemap 的绝对 URL 依赖它。 */
export const SITE_URL = 'https://example.com';

export const SITE_NAME = 'blog by Hetaisheng, HUST';

/** 视觉上那处唯一的毛笔字。不等于 SITE_NAME。 */
export const WORDMARK = '泰生';

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';

/** <html lang> 用的完整标签。Pagefind 靠它建分语言索引，必须正确。 */
export const HTML_LANG: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
};

/** BlogFinder 投稿需要一句话简介。待用户确认措辞。 */
export const TAGLINE: Record<Locale, string> = {
  zh: '写机器人、写 Agent、写生活。偶尔写失败。',
  en: 'On robots, agents, and life. Occasionally on failure.',
};

export const AUTHOR = {
  name: { zh: '何泰生', en: 'He Taisheng' },
  affiliation: { zh: '华中科技大学', en: 'HUST' },
  location: { zh: '武汉', en: 'Wuhan' },
} as const;

export const SOCIAL = {
  github: 'https://github.com/rikfish163-rgb',
} as const;

/**
 * 关于页的公开履历。资料来自用户提供的旧简历截图与公开 GitHub 仓库。
 * 私人手机号、性别、民族、旧 QQ 邮箱和可能已变化的成绩排名不进入公开站点。
 */
export const PROFILE = {
  /** 后续拿到新版简历时一起更新。 */
  resumeAsOf: '2026.09',

  intro: {
    zh: '华中科技大学人工智能专业本科生，关注具身智能、机器人自主探索与 LLM Agent。我更在意系统如何失败、如何被验证，再把这些过程写下来。',
    en: 'An undergraduate in Artificial Intelligence at HUST, working on embodied AI, autonomous robot exploration, and LLM agents. I care about how systems fail, how claims are verified, and how that process can be written down clearly.',
  },

  education: [
    {
      school: { zh: '华中科技大学', en: 'Huazhong University of Science and Technology' },
      degree: { zh: '人工智能专业 · 本科在读', en: 'BEng, Artificial Intelligence' },
      period: '2024.09 — 至今',
      note: {
        zh: '计算机二级；大学英语四级 568 分。',
        en: 'NCRE Level 2; CET-4 score: 568.',
      },
    },
  ],

  /** 项目描述只写公开仓库当前能支持的结论。 */
  projects: [
    {
      name: { zh: '三层危险源搜索机器人', en: 'Three-floor hazard search robot' },
      role: { zh: '华中科技大学智能车队 · 软件组', en: 'HUST Intelligent Vehicle Team · Software' },
      period: '2026',
      summary: {
        zh: '在 Gazebo 三层建筑仿真中整合 FAST-LIO、TEB、Graph NBV 与视觉危险源检测；围绕候选点耗尽、坐标系断链和导航卡死建立运行时诊断与修复链。',
        en: 'Integrated FAST-LIO, TEB, Graph NBV, and visual hazard detection in a three-floor Gazebo environment, with runtime diagnostics for exhausted candidates, broken transforms, and navigation stalls.',
      },
      stack: ['ROS', 'FAST-LIO', 'TEB', 'Graph NBV', 'YOLO', 'Gazebo'],
      link: 'https://github.com/rikfish163-rgb/danger-search-robot',
    },
    {
      name: { zh: 'deepsee', en: 'deepsee' },
      role: { zh: '作者', en: 'Author' },
      period: '2026',
      summary: {
        zh: '为纯文本模型增加本地视觉桥：支持 CLI、Web、MCP、Hook，以及 OpenAI / Anthropic 兼容代理；核心运行时仅使用 Python 标准库。',
        en: 'A local vision bridge for text-only models, available through CLI, Web, MCP, hooks, and OpenAI/Anthropic-compatible proxies, with a standard-library-only core runtime.',
      },
      stack: ['Python', 'MCP', 'OpenAI-compatible API'],
      link: 'https://github.com/rikfish163-rgb/deepsee',
    },
    {
      name: { zh: 'Panda Reactive-IL', en: 'Panda Reactive-IL' },
      role: { zh: '个人研究工程', en: 'Independent research project' },
      period: '2026 — 进行中',
      summary: {
        zh: '在 MuJoCo 中搭建 Franka Panda 视觉抓放与扰动恢复工程。当前完成工程底座与数据契约；正式模仿学习训练和完整验收仍在进行。',
        en: 'A MuJoCo project for vision-based pick-and-place and perturbation recovery with a Franka Panda. The engineering foundation and data contract are in place; formal imitation-learning training and acceptance remain in progress.',
      },
      stack: ['Python', 'MuJoCo', 'Imitation Learning', 'Computer Vision'],
      link: 'https://github.com/rikfish163-rgb/embodied',
    },
  ],

  organizations: [
    {
      name: { zh: '华中科技大学智能车队', en: 'HUST Intelligent Vehicle Team' },
      role: { zh: '软件组成员', en: 'Software team member' },
      period: '',
    },
    {
      name: { zh: '启明 STAR 团队', en: 'Qiming STAR Team' },
      role: { zh: '电控组成员', en: 'Control systems team member' },
      period: '',
    },
  ],

  honors: [
    {
      title: {
        zh: '挑战杯“揭榜挂帅”擂台赛 · 国家级二等奖',
        en: 'Challenge Cup “Jiebang Guashuai” Contest · National Second Prize',
      },
      date: '2025.11',
      level: 'national',
    },
    {
      title: {
        zh: '全国大学生数学建模竞赛 · 湖北赛区一等奖',
        en: 'CUMCM · First Prize, Hubei Division',
      },
      date: '2025.11',
      level: 'provincial',
    },
    {
      title: {
        zh: '全国大学生电子设计竞赛 · 湖北赛区三等奖',
        en: 'NUEDC · Third Prize, Hubei Division',
      },
      date: '2025.08',
      level: 'provincial',
    },
  ],

  competitions: [
    { name: { zh: '全国大学生数学竞赛', en: 'Chinese Mathematics Competitions for College Students' }, period: '2025.11' },
    { name: { zh: '全国大学生数学建模竞赛', en: 'Contemporary Undergraduate Mathematical Contest in Modeling' }, period: '2025.09' },
    { name: { zh: '挑战杯“揭榜挂帅”擂台赛', en: 'Challenge Cup “Jiebang Guashuai” Contest' }, period: '2025.06 — 2025.10' },
    { name: { zh: '挑战杯“人工智能+”专项赛', en: 'Challenge Cup “AI+” Special Contest' }, period: '2025.06 — 2025.10' },
    { name: { zh: '美国大学生数学建模竞赛', en: 'Mathematical Contest in Modeling' }, period: '2025.01' },
    { name: { zh: '院智能车竞赛', en: 'College Intelligent Vehicle Competition' }, period: '2024.12' },
    { name: { zh: '校机器人竞赛', en: 'University Robotics Competition' }, period: '2024.09 — 2024.12' },
    { name: { zh: '狼牙“地瓜杯”机器人竞赛', en: 'Langya “Digua Cup” Robotics Competition' }, period: '2024.10 — 2024.11' },
    { name: { zh: '全国大学生电子设计竞赛', en: 'National Undergraduate Electronics Design Contest' }, period: '2024.07 — 2024.08' },
  ],

  skills: [
    { group: { zh: '编程', en: 'Programming' }, items: ['Python', 'C', 'C++', 'TypeScript', 'Git'] },
    { group: { zh: '机器人', en: 'Robotics' }, items: ['ROS / ROS2', 'SLAM', 'move_base / Nav2', 'Gazebo', 'MuJoCo'] },
    { group: { zh: '嵌入式', en: 'Embedded' }, items: ['Arduino', 'STM32'] },
    { group: { zh: '机器学习', en: 'Machine learning' }, items: ['PyTorch', 'Computer Vision', 'RL', 'LLM Agent'] },
    { group: { zh: '建模', en: 'Modeling' }, items: ['数据分析', '数学建模', 'Data visualization'] },
  ],

  interests: {
    zh: ['足球', '乒乓球', '跑步'],
    en: ['Football', 'Table tennis', 'Running'],
  },

  looking: {
    zh: '关注具身智能、机器人自主探索和 LLM Agent 方向的实习与合作；具体时间、地点和工作方式待补充。',
    en: 'Open to internships and collaboration in embodied AI, autonomous robot exploration, and LLM agents. Timing, location, and work arrangement are to be confirmed.',
  },

  /** 联系方式。手机号与旧 QQ 邮箱不会进入公开站点。 */
  contact: {
    email: '',
    github: 'rikfish163-rgb',
    wechat: '',
    other: '',
  },
} as const;

/**
 * Giscus 需要公开仓库、开启 Discussions，并从 giscus.app 回填 repoId/categoryId。
 * ID 未填时页面只显示本地状态，不会请求第三方脚本；配置完成后才会按需加载评论区。
 */
export const GISCUS = {
  repo: 'rikfish163-rgb/blog',
  repoId: 'R_kgDOUR66sw',
  category: 'Announcements',
  categoryId: 'DIC_kwDOUR66s84DFIOX',
} as const;

/** 首页策展区展示几篇精选 */
export const FEATURED_COUNT = 3;
/** 首页时间流展示几篇 */
export const RECENT_COUNT = 10;
/** 公开统计的逐项审核开关。没有真实数据时页面不会填入示例数字。 */
export const PUBLIC_STATS = {
  writing: true,
  github: false,
  editorTime: false,
  visits: false,
} as const;
