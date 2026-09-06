<?php
namespace Pusher;
use Pusher\Cache\FileCache;
use Pusher\Cache\RedisCache;
use Pusher\Cache\SsdbCache;

/**
 * KV缓存操作类
 */
abstract class KV {

    /**
     * 版本号
     * @var string
     */
    const VERSION = '1.3.5';

    /**
     * 实例池
     * @var array
     */
    public static $_instance = array();

    /**
     * 按照类型取得一个实例
     * @param array $config
     * @return object
     */
    public static function getInstance($config = array()) {
        // 设置监控类型
        if(!isset($config['type'])) {
            $config['type'] = 'default';
        }
        if(isset(self::$_instance[$config['type']]) && self::$_instance[$config['type']] instanceof self) {
            return self::$_instance[$config['type']];
        }
        // 设置过期时间, 当前监控类型下的key统一以seconds作为ttl, 如果key使用不同的ttl需创建多份实例
        if(!isset($config['seconds'])) {
            $config['seconds'] = 0;
        }
        if(isset($config['driver']) && stripos($config['driver'], "redis") !== false) {
            $config['driver'] = 'Redis';
            self::$_instance[$config['type']] = new RedisCache($config);
        } if(isset($config['driver']) && stripos($config['driver'], "ssdb") !== false) {
            $config['driver'] = 'Ssdb';
            self::$_instance[$config['type']] = new SsdbCache($config);
        }else{
            $config['driver'] = 'File';
            self::$_instance[$config['type']] = new FileCache($config);
        }
        return self::$_instance[$config['type']];
    }

    /**
     * 获取当前实例配置
     * @return array $config
     */
    abstract public function getConfig();

    /**
     * 获取$key是否存在,存在返回true,不存在返回false
     * @param string $key 键KEY
     * @return boolean 存在状态
     */
    abstract public function exists($key);

    /**
     * 获取$key的值
     * @param string $key
     * @return int
     */
    abstract public function get($key);

    /**
     * 设置$key的值,设置成功返回true,失败返回false
     * @param string $key 键KEY
     * @param string $val 键KEY的值
     * @param string $expireTTL 键过期时间
     * @return boolean 设置状态
     */
    abstract public function set($key, $val, $expireTTL);

    /**
     * 设置$key的值,如果该$key不存在则设置为$val,否则返回false
     * @param string $key 键KEY
     * @param string $val 键KEY的值
     * @param string $expireTTL 键过期时间
     * @return boolean 设置状态
     */
    abstract public function setnx($key, $val, $expireTTL);

    /**
     * 增加$key的值,返回增加后的值,如果$key不存在则尝试创建之为默认值0然后增加返回
     * @param string $key 键KEY
     * @param int $default 增加大小
     * @param string $expireTTL 键过期时间
     * @return int 增加后的值
     */
    abstract public function incr($key, $default, $expireTTL);

    /**
     * 增加$key的值,减少成功返回true,失败返回false,如果$key不存在则尝试创建之并设置为-1
     * @param string $key 键KEY
     * @param int $default 减小大小
     * @param string $expireTTL 键过期时间
     * @return int 减小后的值
     */
    abstract public function decr($key, $default, $expireTTL);

    /**
     * 删除$key,删除成功返回true,如果$key不存在则返回false
     * @param string $key 键KEY
     * @return boolean 删除状态
     */
    abstract public function del($key);

    /**
     * 删除$key,删除成功返回true,如果$key不存在则返回false
     * @param string $key 键KEY
     * @return boolean 删除状态
     */
    abstract public function delete($key);

    /**
     * 获取$key列表的长度,$key不存在返回0
     * @param string $key 键KEY
     * @return int 列表的长度
     */
    abstract public function llen($key);

    /**
     * 由列表头部添加字符串值,成功返回数组长度,如果不存在则尝试创建之并添加,不是一个列表，返回FALSE
     * @param string $key 键KEY
     * @param string $string 添加的元素的内容
     * @return boolean 添加状态
     */
    abstract public function lpush($key, $string);

    /**
     * 在key对应list的尾部添加字符串元素,返回true表示成功,如果不存在则尝试创建之并列表长度
     * @param string $key 键KEY
     * @param string $string 添加的元素的内容
     * @return mixed 返回数组长度
     */
    abstract public function rpush($key, $string);

    /**
     * 移除列表的第一个元素,成功返回第一个元素的值,失败返回false
     * @param string $key 键KEY
     * @return mixed 移除状态
     */
    abstract public function lpop($key);

    /**
     * 移除列表的最后一个元素,成功返回最后一个元素的值,失败返回false
     * @param string $key 键KEY
     * @return mixed 移除状态
     */
    abstract public function rpop($key);

    /**
     * 获取列表中指定的元素。 0第一个元素，1第二个… -1最后一个元素，-2的倒数第二…错误的索引或键不指向列表则返回FALSE
     * @param string $key 键KEY
     * @param string $index 索引
     * @return mixed 指定元素值,不存在返回FALSE
     */
    abstract public function lget($key, $index);

    /**
     * 设置列表中指定索引的元素值为$val。 0第一个元素，1第二个… -1最后一个元素
     * @param string $key 键KEY
     * @param string $index 索引
     * @param string $val 值
     * @return mixed 指定元素值,不存在返回FALSE
     */
    abstract public function lset($key, $index, $val);

    /**
     * 获取key的过期剩余秒数(当 key 不存在时，返回 -2 。 当 key 存在但没有设置剩余生存时间时，返回 -1)
     * @param string $key 键KEY
     * @return int 离过期剩余秒数
     */
    abstract public function ttl($key);

    /**
     * 设置$key的有效期(文件驱动下仅对当前进程有效)
     * @param string $key 键KEY
     * @param string $seconds 有效时间
     * @return boolean 设置状态
     */
    abstract public function expire($key, $seconds);

    /**
     * 获取前缀为$prefix的所有元素
     * @param string $prefix key前缀
     * @return array 所有key组成的数组
     */
    abstract public function keys($prefix);

}
