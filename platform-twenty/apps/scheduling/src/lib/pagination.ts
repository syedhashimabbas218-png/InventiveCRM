export type Page<TNode> = { edges: { node: TNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

export const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

// Follows the cursor to the last page, so limits and reminders never act on a silently truncated list.
export const allPages = async <TNode>(loadPage: (after: string | null) => Promise<Page<TNode>>) => {
  const found: TNode[] = [];
  let after: string | null = null;
  for (;;) {
    const page: Page<TNode> = await loadPage(after);
    found.push(...page.edges.map((edge) => edge.node));
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return found;
    after = page.pageInfo.endCursor;
  }
};
