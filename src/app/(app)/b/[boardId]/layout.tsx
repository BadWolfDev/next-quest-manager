/**
 * Board layout with a parallel `@modal` slot.
 *
 * The card detail lives at /b/<boardId>/c/<cardId>. An intercepting route
 * renders it *over* the board when you click a card (the board page stays
 * mounted, so its optimistic drag state survives), while a direct visit or a
 * refresh hits the standalone page underneath. That is what makes the URL
 * genuinely shareable rather than a client-only query param.
 */
export default function BoardLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  return (
    <>
      {children}
      {modal}
    </>
  );
}
