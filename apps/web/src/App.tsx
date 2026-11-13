import { useEffect, useState } from "react";

import { EntryPage } from "./EntryPage";
import { ExpenseForm } from "./ExpenseForm";
import { FeedPage } from "./FeedPage";
import { HomePage } from "./HomePage";
import { InvitePage } from "./InvitePage";
import { matchRoute } from "./routes";

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);

  // The phone's "back", and navigate() from routes.ts.
  useEffect(() => {
    const follow = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  const route = matchRoute(pathname);
  return (
    <main>
      {route.page === "home" && <HomePage />}
      {route.page === "expense" && <ExpenseForm />}
      {route.page === "feed" && <FeedPage />}
      {route.page === "entry" && <EntryPage key={route.id} id={route.id} />}
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
