import 'chessgroundx/assets/chessground.base.css';
import './ui/styles.css';
import './ui/pieces.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (root) void startApp(root);
