/** Tác giả của blog. Khoá là giá trị `author` trong meta của bài. */
export const AUTHORS = {
  marcus: {
    type: "Person",
    name: "Marcus",
    role: "Founder, Ferreto",
    url: "https://ferreto.io",
  },
  /** The scheduled teaching posts: a team voice, so no one's first-hand story is invented. */
  opencmo: {
    type: "Organization",
    name: "Ferreto Team",
    role: "Marketing lessons for founders",
    url: "https://ferreto.io",
  },
} as const;

export type AuthorId = keyof typeof AUTHORS;
