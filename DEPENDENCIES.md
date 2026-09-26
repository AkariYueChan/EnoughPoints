# 本地依赖清单

下载日期：2026-09-25。所有 wheel 从 PyPI 下载，固定版本；运行不连接这些网站。

| 库 | 版本 | 用途 | 来源 |
| --- | --- | --- | --- |
| openpyxl | 3.1.5 | 读取 xlsx | https://pypi.org/project/openpyxl/3.1.5/ |
| xlrd | 2.0.2 | 读取 xls | https://pypi.org/project/xlrd/2.0.2/ |
| et-xmlfile | 2.0.0 | openpyxl 的 XML 依赖 | https://pypi.org/project/et-xmlfile/2.0.0/ |
| defusedxml | 0.7.1 | XML 解析保护 | https://pypi.org/project/defusedxml/0.7.1/ |
| xlwt | 1.3.0 | 仅测试：临时生成旧版 xls 样本 | https://pypi.org/project/xlwt/1.3.0/ |

vendor/ 内含已解压库及其 dist-info 元数据/许可证。xlwt 完整许可证额外取自官方 PyPI 源码包，并核对源码包的 PyPI SHA-256。

## 离线安装包 SHA-256

`defusedxml-0.7.1-py2.py3-none-any.whl`
`a352e7e428770286cc899e2542b6cdaedb2b4953ff269a210103ec58f6198a61`

`et_xmlfile-2.0.0-py3-none-any.whl`
`7a91720bc756843502c3b7504c77b8fe44217c85c537d85037f0f536151b2caa`

`openpyxl-3.1.5-py2.py3-none-any.whl`
`5282c12b107bffeef825f4617dc029afaf41d0ea60823bbb665ef3079dc79de2`

`xlrd-2.0.2-py2.py3-none-any.whl`
`ea762c3d29f4cca48d82df517b6d89fbce4db3107f9d78713e48cd321d5c9aa9`

`xlwt-1.3.0-py2.py3-none-any.whl`
`a082260524678ba48a297d922cc385f58278b8aa68741596a87de01a9c628b2e`

## 不需要打包的部分

HTTP 服务、SQLite、JSON、ZIP 等使用 Python 标准库；前端使用浏览器标准能力，不加载任何 CDN。Python 解释器需由运行电脑提供（3.10+）。
