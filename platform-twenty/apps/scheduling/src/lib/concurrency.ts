export const mapWithConcurrency = async <TItem, TResult>(items: TItem[], limit: number, work: (item: TItem) => Promise<TResult>) => {
  const results = new Array<TResult>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index] as TItem);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
};
