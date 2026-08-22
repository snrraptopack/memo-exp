/**
 * Application Browser Entry Point
 * 
 * Demonstrates:
 * 1. Single top-level `mount` call binding the root component factory to '#root'
 * 2. Importing global Tailwind CSS styles
 */

import { mount } from '@memoized-dom/runtime';
import { App } from './App';
import './styles.css';

// Mount application to DOM
mount('root', App);
