import { HomePage } from "./HomePage";
import { InvitePage } from "./InvitePage";
import { matchRoute } from "./routes";

export function App() {
  const route = matchRoute(window.location.pathname);
  return (
    <main>
      {route.page === "home" && <HomePage />}
      {route.page === "invite" && <InvitePage token={route.token} />}
      {route.page === "not-found" && (
        <section>
          <h1>Página não encontrada</h1>
          <p>
            <a href="/">Voltar ao início</a>
          </p>
        </section>
      )}
    </main>
  );
}
