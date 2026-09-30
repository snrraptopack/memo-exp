import { mount } from "@memoized-dom/runtime";
import { CommonGroundApp } from "./App";
import "./styles.css";
import { restoreSession } from "./state";
restoreSession();
mount("root", CommonGroundApp);
