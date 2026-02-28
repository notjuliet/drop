import { Router, Route } from "@solidjs/router";
import { render } from "solid-js/web";

import App from "./App";
import Upload from "./pages/Upload";
import View from "./pages/View";

import "./styles.css";

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Upload} />
      <Route path="/p/:id" component={View} />
    </Router>
  ),
  document.getElementById("root")!,
);
