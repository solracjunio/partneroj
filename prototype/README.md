# Clickable prototype (block 0)

Nine screens for the timed test with the partners, served at `https://partneroj.com.br/prototipo/`. It uses plain HTML, CSS and JavaScript, with no build step and no backend. Nothing is saved, and the receipt photo never leaves the phone.

1. **Início:** how much each partner has put in, against each partner's goal.
2. **Lancei um gasto:** amount, category, who paid, whose name is on the receipt, and the photo.
3. **A foto ficou boa?:** the photo check.
4. **Gasto lançado:** the confirmation, with "Desfazer" (undo with a reason).
5. **Atividades:** tap an entry to open it.
6. **Votações:** every vote, with who still has to agree. The partners chose unanimity ([ADR 0004](../docs/adr/0004-votacao-sobre-lancamento-por-unanimidade.md)), so the first "no" rejects the proposal and nothing changes.
7. **Lançamento:** an entry's details. On your own entry the button is "Desfazer"; on someone else's it is "Discordo deste lançamento". Neither shows on an entry that was undone or already has an open vote.
8. **Discordo:** propose to fix the amount or to archive the entry, with a required reason. This opens a 7-day vote, and the entry keeps counting in the balances, marked as under vote. After a rejection, the entry cannot be contested again.
9. **Acerto final:** a partner announces the final settlement. From then on nobody opens a new vote, and 7 days later, when the open votes have ended, the settlement comes out. It gives back what each partner put in, splits the profit (sale minus expenses) in equal shares by the largest remainder, and lists who pays whom by Pix, with the warning that the settlement does not decide who owns the property. A prototype-only button skips the 7 days.

## Names

Real names and amounts never go in git. They go in the link fragment, which the browser does not send to the server:

```
https://partneroj.com.br/prototipo/#eu=Name&outros=Name2,Name3&nota=Name2&meta=50000&venda=60000&recebeu=Name2&t=1
```

- `eu`: the person holding the phone.
- `outros`: the other two partners.
- `nota`: the default name on the receipt.
- `meta`: each partner's goal in reals.
- `venda`: the sale price in reals, for the final settlement.
- `recebeu`: who received the sale money (defaults to `nota`).
- `t=1`: show the seconds from "Lancei um gasto" to "Salvar".

Without a fragment, the prototype uses made-up names, a made-up goal and a made-up sale price.

## Guided test

With `teste=<secret>` in the fragment, `test.js` turns the prototype into a guided test for one person: a screen saying what is recorded, 4 timed tasks (enter an expense, vote, contest an entry, do the final settlement) with a bar to skip each one, 3 questions, and then free use. The events go to the collector in [`infra/prototype-test`](../infra/prototype-test/README.md). Without the token, nothing is sent.

## Deploy

See [`infra/prototype-test`](../infra/prototype-test/README.md).
