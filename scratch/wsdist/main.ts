import * as _MD from "@memoized-dom/runtime";
import { mount } from '@memoized-dom/runtime';
import { installWorkspaceApi } from './api';
import { WorkspaceApp } from './WorkspaceApp';
import './styles.css';
installWorkspaceApi();
mount('root', WorkspaceApp);