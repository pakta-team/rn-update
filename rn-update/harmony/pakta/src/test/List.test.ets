/**
 * [INPUT]: 依赖四个 Hypium 测试注册函数，汇集 manifest、校验、事件和任务参数套件
 * [OUTPUT]: 提供 Harmony test runner 的统一 testsuite 入口
 * [POS]: pakta 测试发现层，只组合测试，不承载任何生产逻辑
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import manifestParsingTest from './ManifestParsing.test';
import validationTest from './Validation.test';
import eventHubTest from './EventHub.test';
import downloadTaskParamsTest from './DownloadTaskParams.test';
import contentRangeTest from './ContentRange.test';
import installRecordTest from './InstallRecord.test';
import errorCodesTest from './ErrorCodes.test';

export default function testsuite() {
  manifestParsingTest();
  validationTest();
  eventHubTest();
  downloadTaskParamsTest();
  contentRangeTest();
  installRecordTest();
  errorCodesTest();
}
