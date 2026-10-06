import { Logger } from '@nestjs/common';

// Services log through Nest's Logger. Expected warnings/errors in tests are noise, not signal.
Logger.overrideLogger(false);
