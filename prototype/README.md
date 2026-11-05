# Clickable prototype (block 0)

Six screens for the timed test with the family, served at `https://partneroj.com.br/prototipo/`. It uses plain HTML, CSS and JavaScript, with no build step and no backend. Nothing is saved, and the receipt photo never leaves the phone.

1. **Início:** how much each partner has put in, against each partner's goal.
2. **Lancei um gasto:** amount, category, who paid, whose name is on the receipt, and the photo.
3. **A foto ficou boa?:** the photo check.
4. **Gasto lançado:** the confirmation, with "Desfazer" (undo with a reason).
5. **Atividades:** the feed.
6. **Votação:** a vote, then the 2-against-1 case under both rules, for the family to choose.

## Names

Real names and amounts never go in git. They go in the link fragment, which the browser does not send to the server:

```
https://partneroj.com.br/prototipo/#eu=Name&outros=Name2,Name3&nota=Name2&meta=50000&t=1
```

- `eu`: the person holding the phone.
- `outros`: the other two partners.
- `nota`: the default name on the receipt.
- `meta`: each partner's goal in reals.
- `t=1`: show the seconds from "Lancei um gasto" to "Salvar".

Without a fragment, the prototype uses made-up names and a made-up goal.

## Deploy

```sh
rsync -a --delete prototype/ partneroj:~/hello/prototipo/
```
