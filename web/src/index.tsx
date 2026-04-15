import { render } from "solid-js/web";
import App from "./App";
import Upload from "./pages/Upload";
import View from "./pages/View";

import "./styles.css";

const Page = () => (location.pathname === "/" ? <Upload /> : <View />);

render(
  () => (
    <App>
      <Page />
    </App>
  ),
  document.getElementById("root")!,
);
