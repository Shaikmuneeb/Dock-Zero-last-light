import { router, protectedProcedure } from './webdev-adapter.mjs'

export const gameRouter = router({
  // Add gameplay writes and Stripe Checkout creation as protectedProcedure
  // mutations. Derive the buyer/save owner from ctx.user, never browser input.
  player: protectedProcedure.query(({ ctx }) => ({ id: ctx.user.id, name: ctx.user.name })),
})
