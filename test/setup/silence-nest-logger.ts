import { Logger } from '@nestjs/common';

// Services log through Nest's Logger. Expected warnings/errors in tests are noise, not signal;
// tests that check an alert spy on Logger.prototype.error instead.
Logger.overrideLogger(false);
