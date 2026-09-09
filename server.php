<?php
header("Access-Control-Allow-Origin: *");
// 允许的 HTTP 请求方法
header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
// 允许的请求头（如果前端发送了自定义 Header，如 Authorization，必须在此列出）
header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
// 处理预检请求（OPTIONS）
if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
    http_response_code(200);
    exit();
}

date_default_timezone_set("PRC");
header("content:application/json;chartset=uft-8");
include __DIR__ . "/KV.php";
include __DIR__ . "/RedisCache.php";
include __DIR__ . "/FileCache.php";

// file缓存配置（redis需要composer安装的predis依赖）
$redisConfig = array(
    // 可选File(文件缓存), Redis(Redis缓存)
    "driver" => "File",
    // redis node节点
    //"nodes" => $nodes
);
$kv = Pusher\KV::getInstance($redisConfig);

// 服务器响应值
$resultModel = array(
    "code" => 0,
    "data" => array(),
);

// TOOD: 统一校验server.php所在页面的权限(已登录用户)

// 弹幕消息统一前缀
$redisPrefix = "danmu:";

// 路由操作类型
$type = isset($_GET["type"]) ? $_GET["type"] : "";

// 不同的处理逻辑: init弹幕初始化仅触发一次; filter每一条弹幕经过后端过滤后决定是否展示; click每次点击/关闭弹幕可以修改业务数据; checkAiDanMu前端定时轮询后端AI弹幕(AI陪伴, 历史评论)
if($type == "init") {

    // 启动时可以将业务id和channelCode进行一对一绑定
    $bizId = isset($_GET["bizId"]) ? $_GET["bizId"] : "";
    $channelCode = isset($_GET["channelCode"]) ? $_GET["channelCode"] : "";
    $nickname = isset($_GET["nickname"]) ? $_GET["nickname"] : "你";

    if(empty($channelCode)) {
        $resultModel["code"] = -1;
        $resultModel["message"] = "通道码不正确";
        echo cross_domain(json_encode($resultModel));
        exit();
    }
    // 可以给弹幕带上自定义链接, 但需要满足每30秒内只有一个带连接的url, 这里加上随机数可以跳过限制
    $url = isset($_GET["url"]) ? $_GET["url"] : $_SERVER["HTTP_REFERER"];

    // 自定义发布人头像和欢迎语
    $avatar = "https://www.phprm.com/push/h5/static/avatar/danMu.png";

    // 查询数据库中的评论放到线程池中逐条通过推送API发布
    $bizCacheJson = $kv -> get($redisPrefix . "biz:". $bizId);
    if(empty($bizCacheJson)) {
        $ready = array(
            "bizId" => $bizId,
            "likeCount" => 99
        );
    } else {
        $ready = json_decode($bizCacheJson, true);
    }

    // 弹幕通道已经全部使用预设通道码加签, 需要额外传timestamp、nonce、sign三个参数, $signSecret请查看http://push.phprm.com/config.html
    $signSecret = "3f506231f2bbdd44026990080d430abe";
    $timestamp = getMillisecond();
    $nonce = md5(time());
    $rawText = "${timestamp}#${signSecret}#${nonce}";
    $sign = md5($rawText);

    // 独享模式: 仅当前用户可见, 发送完私信不存redis, 让前端存messageIdList缓存
    $time = explode(" ", microtime());
    $url = strpos($url, "?") === false ? $url . "?time=".$time[0] : $url . "&time=".$time[0];
    $sendUrl = "http://www.phprm.com/services/push/trigger/${channelCode}?delayMilliseconds=5000&url=".rawurlencode($url)."&head=".urlencode($nickname.", 你有一条私信仅自己可见"). "&timestamp=".$timestamp. "&nonce=".$nonce. "&sign=".$sign;
    $json = file_get_contents($sendUrl);
    $jsonObject = json_decode($json, true);

    // 返回给前端的白名单消息ID
    $messageIdList = empty($jsonObject["data"]["messageIdList"]) ? array() : $jsonObject["data"]["messageIdList"];

    $timestamp = getMillisecond();
    $nonce = md5(time());
    $rawText = "${timestamp}#${signSecret}#${nonce}";
    $sign = md5($rawText);
    // 调用推送API（延迟5秒后才推送到弹幕，防止用户本地弹幕还未建立连接成功就发送弹幕）, 还需注意自动创建的弹幕通道是否开启了签名: http://push.phprm.com/api.html#sign
    $time = explode(" ", microtime());
    $url = strpos($url, "?") === false ? $url . "?time=".$time[0] : $url . "&time=".$time[0];
    $nextUrl = "http://www.phprm.com/services/push/trigger/${channelCode}?delayMilliseconds=5000&url=".rawurlencode($url)."&head=".urlencode("大家欢迎".$nickname.", 一大波弹幕来袭"). "&timestamp=".$timestamp. "&nonce=".$nonce. "&sign=".$sign;
    $json = file_get_contents($nextUrl);
    $jsonObject = json_decode($json, true);

    if(empty($jsonObject) || empty($jsonObject["data"]["messageIdList"])) {
        // 公开弹幕推送失败
        $resultModel["code"] = -1;
        $resultModel["message"] = "公开弹幕推送失败";
        $resultModel["data"] = $json;
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // 共享模式: 后面的所有消息公开可见, 发送完公开信需要存redis: $kv -> set($redisPrefix . "messageId:". $messageId, "1", 600);缓存起来到filter里验证是否由本系统触发
    foreach($jsonObject["data"]["messageIdList"] as $messageId) {
        // 存什么不重要, 重要的是type=filter能校验通过, bizId可以存这里, 后端可以在filter里从messageId缓存读出关联的bizId
        $kv -> set($redisPrefix . "messageId:". $messageId, $bizId, 600);
    }

    // 可选: 缓存每个业务的点赞数(仅用于示例filer查询到点赞数)
    $kv -> set($redisPrefix . "biz:". $ready["bizId"], json_encode($ready), 86400);

    // 前端将messageIdList加入this.settings.messageIdList跳过filter过滤, 不是当前用户触发的弹幕不会展示
    $resultModel["data"] = array("messageIdList" => $messageIdList);
    echo cross_domain(json_encode($resultModel));
    exit();

} else if($type == "filter") {

    // 除了AI弹幕，所有用户发送的弹幕都会走到过滤逻辑
    $messageId = isset($_GET["messageId"]) ? $_GET["messageId"] : 0;
    $bizId = isset($_GET["bizId"]) ? $_GET["bizId"] : "";

    if(empty($messageId)) {
        $resultModel["code"] = -1;
        $resultModel["message"] = "messageId不正确";
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    $messageJson = $kv->get($redisPrefix . "messageId:" . $messageId);
    if(empty($messageJson)) {
        // 非本系统触发或者缓存已过期
        $resultModel["code"] = -1;
        $resultModel["message"] = "弹幕有效期已过期";
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    $bizCacheJson = $kv->get($redisPrefix . "biz:" . $bizId);
    $bizObject = json_decode($bizCacheJson, true);

    if(empty($bizObject)) {
        // 业务(例如评论)应当从数据库查询, 未查到不展示弹幕或者将弹幕数据持久化到
        $resultModel["code"] = -1;
        $resultModel["message"] = "未查询到有效业务数据";
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // 如果danMuSetting.like=1, 需要从数据库中查询出bizId对应的点赞数likeCount
    $resultModel["data"] = $bizObject;
    echo cross_domain(json_encode($resultModel));
    exit();

} else if($type == "click") {

    // click操作类型
    $action = isset($_GET["action"]) ? $_GET["action"] : "like";
    $bizId = isset($_GET["bizId"]) ? $_GET["bizId"] : "";
    if(empty($bizId)) {
        $resultModel["code"] = -1;
        $resultModel["message"] = "业务ID不正确";
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // 点赞操作
    if ($action == "like") {

        $bizCacheJson = $kv->get($redisPrefix . "biz:" . $bizId);
        $bizObject = json_decode($bizCacheJson, true);

        if(empty($bizObject)) {
            // 业务(例如评论)应当从数据库查询, 未查到不更新点赞数
            $resultModel["code"] = -1;
            $resultModel["message"] = "未查询到有效业务数据";
            echo cross_domain(json_encode($resultModel));
            exit();
        }

        // 如果like:1, 将业务点击次数+1
        $bizObject["likeCount"] = $bizObject["likeCount"] + 1;

        // 更新业务数据里的点赞次数
        $kv -> set($redisPrefix . "biz:". $bizObject["bizId"], json_encode($bizObject), 86400);

        $resultModel["data"] = $bizObject;
    }
    // TODO: close（举报不良弹幕）关闭事件
    echo cross_domain(json_encode($resultModel));
    exit();

} else if($type == "checkAiDanMu") {

    $channelCode = isset($_GET["channelCode"]) ? $_GET["channelCode"] : "";
    $pollCount = isset($_GET["pollCount"]) ?  (int) $_GET["pollCount"] : 0;

    if ($pollCount > 1000) {
        $resultModel["message"] = "全村的笋都被你夺完了, 刷新完页面再试吧, pollCount=".$pollCount;
        // 超过1000次不允许重试
        $resultModel["data"] = array("aiRestAmount" => 0, "messageIdList" => array());
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // 慎重: 这里需要使用redis对TPS进行流控, 否则弹幕数将与请求同一个接口的人数成正比, 影响所有打开同一个页面体验, 可以给$channelCode加一个setNx快速失败的检测锁（有效期应该大于本脚本执行耗时小于js里面aiDanMu传参)
    $setFlag = $kv -> setnx($redisPrefix . "lock:" . $channelCode, json_encode($_GET), 2);

    if (!$setFlag) {
        $resultModel["code"] = 0;
        $resultModel["message"] = "加锁失败, 有人已经触发了AI弹幕, pollCount=".$pollCount;
        // 查询计数器剩余有效时间
        $ttl = $kv -> ttl($redisPrefix . "lock:" . $channelCode);
        if ($ttl <= 0) {
            $kv -> delete($redisPrefix . "lock:" . $channelCode);
        }
        // 加锁失败允许下次重试需要返回大于0的aiRestAmount
        $resultModel["data"] = array("aiRestAmount" => 1, "messageIdList" => array());
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // 限流: 每1分钟可调用5次
    $aiRestAmountKey = $redisPrefix . "rest:" . $channelCode;
    $kv -> setnx($aiRestAmountKey, 5, 60);
    // 每次访问-1
    $aiRestAmount = $kv -> decr($aiRestAmountKey);
    if ($aiRestAmount <= 0) {
        // 查询计数器剩余有效时间
        $ttl = $kv -> ttl($aiRestAmountKey);
        if ($ttl <= 0) {
            $kv -> delete($aiRestAmountKey);
        }

        $resultModel["message"] = "当前AI弹幕额度已耗尽, 请".$ttl."秒后再试, pollCount=".$pollCount;
        // 正式环境，需要产品/开发者自行决定aiRestAmount返回0还是1, 如果返回0前端将终止轮询
        $resultModel["data"] = array("aiRestAmount" => 1, "messageIdList" => array());
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // 业务执行: 这里可以拿着$title去请求AI接口, 拿到返回值拼接成head调用推送API
    $aiUrl = "https://api.moonshot.cn/anthropic/v1/messages";
    $aiUrl = "https://api.deepseek.com/";
    //$chatResult = requestAI($aiUrl, 'sk-fake', 'kimi-k3');
    //$chatResult = requestAI($aiUrl, 'sk-fake', 'deepseek-v4-flash');


    // 降级为其他弹幕内容
    $head = "你正访问的网页标题是: ".$_GET["title"];
    if (!empty($chatResult['choices'][0]['message']['content']) || !empty($chatResult['choices'][0]['message']['reasoning_content'])) {
        $answer = !empty($chatResult['choices'][0]['message']['content']) ? trim($chatResult['choices'][0]['message']['content']) : trim($chatResult['choices'][0]['message']['reasoning_content']);
        // 设置缓存
        $head = empty($answer) ? "AI响应数据异常" : $answer;
    }
    // 自定义发布人头像
    $avatar = "https://www.phprm.com/push/h5/static/avatar/danMu.png";

    // 弹幕通道已经全部使用预设通道码加签, 需要额外传timestamp、nonce、sign三个参数
    $signSecret = "3f506231f2bbdd44026990080d430abe";
    $timestamp = getMillisecond();
    $nonce = md5(time());
    $rawText = "${timestamp}#${signSecret}#${nonce}";
    $sign = md5($rawText);

    // 假设已从AI大模型拿到了返回值, 推送后立即将$messageIdList在触发的前端注册(减少当触发filter请求)
    $sendUrl = "http://www.phprm.com/services/push/trigger/${channelCode}?delayMilliseconds=1000&head=".urlencode($head) . "&avatar=".rawurlencode($avatar). "&timestamp=".$timestamp. "&nonce=".$nonce. "&sign=".$sign;
    $json = file_get_contents($sendUrl);
    $jsonObject = json_decode($json, true);

    if(empty($jsonObject) || empty($jsonObject["data"]["messageIdList"])) {
        // 弹幕消息推送失败
        $resultModel["code"] = -1;
        $resultModel["message"] = "弹幕消息推送失败";
        $resultModel["data"] = $json;
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // AI弹幕可以在共享模式给其他用户看到
    foreach($jsonObject["data"]["messageIdList"] as $messageId) {
        // 如果不重写settings.checkAiDanMu方法, 这里只能存$channelCode
        $kv -> set($redisPrefix . "messageId:". $messageId, $channelCode, 600);
    }

    // AI推送的弹幕不需要后端缓存, 前端缓存了messageIdList, 只需将messageIdList返回给前端跳过过滤动作(适合所有人接收)
    $messageIdList = $jsonObject["data"]["messageIdList"];
    $resultModel["data"] = array("aiRestAmount" => $aiRestAmount, "messageIdList" => $messageIdList, "response" => $json);
    echo cross_domain(json_encode($resultModel));
    exit();

}else if($type == "send") {
    // 业务后端接受到弹幕后，可以推送弹幕并使用redis缓存messageIdList，也可以审核通过后推送给所有人
    $channelCode = isset($_GET["channelCode"]) ? $_GET["channelCode"] : "";
    // bizId应该是文章ID, 不是评论ID, 可在filter中判断消息缓存redis中存的bizId和参数bizId是否一致
    $bizId = isset($_GET["bizId"]) ? $_GET["bizId"] : 1;

    // 业务方可根据$head按自己的敏感词库进行过滤，如果内容触发敏感可立即返回
    $head = isset($_GET["head"]) ? $_GET["head"] : "";

    if(empty($channelCode)) {
        $resultModel["code"] = -1;
        $resultModel["message"] = "通道码不正确";
        echo cross_domain(json_encode($resultModel));
        exit();
    }
    // 可以给弹幕带上自定义链接, 但需要满足每30秒内只有一个带连接的url, 这里加上随机数可以跳过限制
    $url = isset($_GET["url"]) ? $_GET["url"] : $_SERVER["HTTP_REFERER"];

    // 查询当前登录用户的头像网址
    $avatar = "https://www.phprm.com/push/h5/static/avatar/danMu.png";

    // 弹幕通道已经使用预设通道码加签, 需要额外传timestamp、nonce、sign三个参数, $signSecret请查看http://push.phprm.com/config.html
    $signSecret = "3f506231f2bbdd44026990080d430abe";
    $timestamp = getMillisecond();
    $nonce = md5(time());
    $rawText = "${timestamp}#${signSecret}#${nonce}";
    $sign = md5($rawText);
    // 调用推送API（延迟1秒后才推送到弹幕，防止用户本地弹幕还未建立连接成功就发送弹幕）, 还需注意自动创建的弹幕通道是否开启了签名: http://push.phprm.com/api.html#sign
    $time = explode(" ", microtime());
    $url = strpos($url, "?") === false ? $url . "?time=".$time[0] : $url . "&time=".$time[0];
    // head为弹幕内容, 200字以内, 如果是公告类型弹幕不要传url参数，传body=公告markdown文档
    $nextUrl = "http://www.phprm.com/services/push/trigger/${channelCode}?delayMilliseconds=1000&url=".rawurlencode($url)."&avatar=".rawurlencode($avatar)."&head=".urlencode($head). "&timestamp=".$timestamp. "&nonce=".$nonce. "&sign=".$sign;
    $json = file_get_contents($nextUrl);
    $jsonObject = json_decode($json, true);

    if(empty($jsonObject) || empty($jsonObject["data"]["messageIdList"])) {
        // 公开弹幕推送失败
        $resultModel["code"] = -1;
        $resultModel["message"] = "公开弹幕推送失败";
        $resultModel["data"] = $json;
        echo cross_domain(json_encode($resultModel));
        exit();
    }

    // 共享模式: 后面的所有消息公开可见, 发送完公开信需要存redis: $kv -> set($redisPrefix . "messageId:". $messageId, "1", 600);缓存起来到filter里验证是否由本系统触发
    foreach($jsonObject["data"]["messageIdList"] as $messageId) {
        $kv -> set($redisPrefix . "messageId:". $messageId, $bizId, 600);
    }

    // 前端将messageIdList加入this.settings.messageIdList跳过filter过滤, 不是当前用户触发的弹幕不会展示
    $resultModel["data"] = array("messageIdList" => $jsonObject["data"]["messageIdList"]);
    echo cross_domain(json_encode($resultModel));
    exit();

}

// 获取毫秒时间戳, java: System.currentTimeMillis()
function getMillisecond() {
    list($s1, $s2) = explode(' ', microtime());
    return number_format((floatval($s1) + floatval($s2)) * 1000, 0, '', '');
}

// 请求AI获得答案
function requestAI($url, $apiKey, $model) {
    // 自己发挥提示词: 未重写danMuSetting.aiDanMuUrl可在http://push.phprm.com/message.html页面修改群组提醒/弹幕提示词覆盖下面的提示词
    $content = "你是一个知心陪伴师，当前需要陪伴当前用户浏览各种网页，请分析网页的document.title和部分document.body.innerText属性后，请上网查询一些攻略、更多方法和作为用户想了解的内容，按用户视角以20~40字发送一条与页面已有内容不同的弹幕，弹幕字数分布应该概率上平均不能太少也不能太多，不能彩虹屁要口语化接地气，回答的内容不能含有“弹幕“、“网页“等技术名词，也不能带任何标点符号，不能推荐也不能带暗示等方式打广告，也不能听起来像打广告。document.title为".$_GET["title"]."，document.body.innerText为".$_GET["body"];
    // AI请求参数
    $payload = array(
        'model' => $model,
        'messages' => array(
            array('role' => 'user', 'content' => $content)
        ),
        'max_tokens' => 3000
    );
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, array(
        'Content-Type: application/json',
        'anthropic-version: 2023-06-01',
        'Authorization: Bearer '. $apiKey,
        'x-api-key: ' . $apiKey
    ));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 20);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        $resultModel = array(
            "code" => 0,
            "message" => $response,
            "data" => array("aiRestAmount" => 1, "messageIdList" => array())
        );
        echo cross_domain(json_encode($resultModel));
        exit();
    }
    // 解析 AI 响应
    $chatResult = json_decode($response, true);
    if (empty($chatResult)) {
        $resultModel = array(
            "code" => 0,
            "message" => "AI响应 Invalid response:" .$response,
            "data" => array("aiRestAmount" => 1, "messageIdList" => array())
        );
        echo cross_domain(json_encode($resultModel));
        exit();
    }
    return $chatResult;
}

// 跨域json解决方案
function cross_domain($jsonString) {
    header('P3P: CP=CAO PSA OUR');
    return $jsonString;
}