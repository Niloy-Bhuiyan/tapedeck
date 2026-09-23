#!/usr/bin/env node
import { defaultIO, main } from './main.js';

process.exitCode = await main(process.argv.slice(2), defaultIO());
